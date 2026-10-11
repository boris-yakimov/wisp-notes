import { create } from 'zustand'
import { Cache, type Draft } from '../cache/db.ts'
import type { GitHubClient, Snapshot } from '../github/client.ts'
import { GitHubError, isNetworkError, toGitHubError } from '../github/errors.ts'
import { gitBlobSha } from '../github/sha.ts'
import { AutoSaver, type SaveStatus } from './autosave.ts'
import { commitChanges, describeChanges, type Change, type CommitResult } from './commit.ts'
import { dirname, isMetaPath, isNotePath } from './paths.ts'
import { parseMeta, type FolderMeta } from './tree.ts'

export interface Notice {
  id: number
  kind: 'info' | 'error'
  message: string
}

/** Reactive state for the UI. Mutated only by RepoSession. */
export interface RepoState {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  online: boolean
  /** What the UI shows (may include optimistic, not-yet-committed operations). */
  snapshot: Snapshot | null
  metas: Record<string, FolderMeta>
  /** Paths with unsaved edits. */
  dirty: Record<string, true>
  saveStatus: SaveStatus
  saveError: string | null
  notices: Notice[]
}

const initialState: RepoState = {
  phase: 'idle',
  error: null,
  online: true,
  snapshot: null,
  metas: {},
  dirty: {},
  saveStatus: 'saved',
  saveError: null,
  notices: [],
}

export const useRepo = create<RepoState>(() => ({ ...initialState }))

let noticeId = 0
export function notify(message: string, kind: Notice['kind'] = 'info'): void {
  const n = { id: ++noticeId, kind, message }
  useRepo.setState((s) => ({ notices: [...s.notices, n] }))
  setTimeout(() => dismissNotice(n.id), kind === 'error' ? 10_000 : 6000)
}
export function dismissNotice(id: number): void {
  useRepo.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
}

export interface SessionOptions {
  idleMs?: number
  maxMs?: number
  now?: () => Date
}

type Listener = () => void

/**
 * One connected repository. Owns the GitHub client, IndexedDB cache, drafts,
 * the auto-saver, and serializes all commits. Exposes reactive state via `useRepo`.
 */
export class RepoSession {
  readonly saver: AutoSaver
  /** Last snapshot confirmed by GitHub. Base for all commits. */
  private remote: Snapshot | null = null
  private shas = new Map<string, string>()
  private drafts = new Map<string, Draft>()
  /** Last saved content of notes read/written this session (path -> content). */
  private savedContent = new Map<string, string>()
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<Listener>()
  private disposed = false
  private now: () => Date

  readonly client: GitHubClient
  readonly cache: Cache
  readonly repoKey: string

  constructor(client: GitHubClient, cache: Cache, repoKey: string, opts: SessionOptions = {}) {
    this.client = client
    this.cache = cache
    this.repoKey = repoKey
    this.now = opts.now ?? (() => new Date())
    this.saver = new AutoSaver(
      () => this.flushDrafts(),
      (saveStatus, saveError) => {
        useRepo.setState({ saveStatus, saveError })
        if (saveStatus === 'offline') useRepo.setState({ online: false })
      },
      { idleMs: opts.idleMs, maxMs: opts.maxMs },
    )
    useRepo.setState({ ...initialState })
  }

  dispose(): void {
    this.disposed = true
    this.saver.dispose()
    this.listeners.clear()
  }

  /** Subscribe to snapshot/draft changes (e.g. the search index). */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  // ---------------------------------------------------------------- loading

  /** Show cached state instantly, restore drafts, then revalidate against GitHub. */
  async start(): Promise<void> {
    useRepo.setState({ phase: 'loading' })
    const [cached, drafts] = await Promise.all([
      this.cache.getSnapshot(this.repoKey),
      this.cache.getDrafts(this.repoKey),
    ])
    this.drafts = new Map(drafts.map((d) => [d.path, d]))
    useRepo.setState({ dirty: Object.fromEntries(drafts.map((d) => [d.path, true as const])) })
    if (cached) {
      await this.setRemote(cached, false)
      useRepo.setState({ phase: 'ready' })
    }
    await this.revalidate()
    if (this.drafts.size > 0 && !this.disposed) void this.saver.saveNow()
  }

  /** Fetch the current head; only blobs whose SHA is not cached are downloaded later. */
  async revalidate(): Promise<void> {
    try {
      const snap = await this.client.getSnapshot()
      useRepo.setState({ online: true })
      if (snap.commitSha !== this.remote?.commitSha) await this.setRemote(snap, true)
      useRepo.setState({ phase: 'ready', error: null })
    } catch (e) {
      const err = toGitHubError(e)
      if (err.kind === 'network') {
        useRepo.setState({ online: false })
        if (!this.remote) {
          useRepo.setState({
            phase: 'error',
            error: 'You are offline and no cached copy of the notes exists yet.',
          })
        }
      } else if (!this.remote) {
        useRepo.setState({ phase: 'error', error: err.message })
      } else {
        notify(`Could not refresh: ${err.message}`, 'error')
      }
    }
  }

  private async setRemote(snap: Snapshot, persist: boolean): Promise<void> {
    this.remote = snap
    this.showSnapshot(snap)
    if (persist) await this.cache.putSnapshot(this.repoKey, snap)
    await this.loadMetas(snap)
  }

  private showSnapshot(snap: Snapshot) {
    this.shas = new Map(snap.entries.map((e) => [e.path, e.sha]))
    useRepo.setState({ snapshot: snap })
    this.emit()
  }

  private async loadMetas(snap: Snapshot): Promise<void> {
    const metas: Record<string, FolderMeta> = {}
    await Promise.all(
      snap.entries
        .filter((e) => isMetaPath(e.path))
        .map(async (e) => {
          try {
            metas[dirname(e.path)] = parseMeta(await this.readBlob(e.sha))
          } catch {
            /* offline and not cached: fall back to default icon */
          }
        }),
    )
    if (this.remote === snap || useRepo.getState().snapshot === snap) useRepo.setState({ metas })
  }

  // ---------------------------------------------------------------- reading

  shaOf(path: string): string | undefined {
    return this.shas.get(path)
  }

  exists(path: string): boolean {
    return this.shas.has(path)
  }

  /** Blob content by SHA: IndexedDB first, then GitHub (and cache it). */
  async readBlob(sha: string): Promise<string> {
    const cached = await this.cache.getBlob(sha)
    if (cached !== undefined) return cached
    const content = await this.client.getBlob(sha)
    await this.cache.putBlob(sha, content)
    return content
  }

  /** Cached content only (no network). */
  async readCached(path: string): Promise<string | undefined> {
    const d = this.drafts.get(path)
    if (d) return d.content
    const sha = this.shas.get(path)
    return sha ? this.cache.getBlob(sha) : undefined
  }

  /** Current content of a note: unsaved draft, else blob. */
  async readNote(path: string): Promise<string> {
    const d = this.drafts.get(path)
    if (d) return d.content
    const sha = this.shas.get(path)
    if (!sha) throw new GitHubError('not-found', `Note "${path}" does not exist.`)
    try {
      const content = await this.readBlob(sha)
      this.savedContent.set(path, content)
      return content
    } catch (e) {
      if (isNetworkError(e)) throw new GitHubError('network', 'This note is not available offline yet.')
      throw e
    }
  }

  /** Download all uncached note blobs (limited concurrency). Returns number fetched. */
  async prefetchNotes(concurrency = 4): Promise<number> {
    const snap = this.remote
    if (!snap) return 0
    const notes = snap.entries.filter((e) => isNotePath(e.path))
    const cached = await this.cache.cachedShas(notes.map((e) => e.sha))
    const todo = [...new Set(notes.map((e) => e.sha).filter((s) => !cached.has(s)))]
    let i = 0
    let fetched = 0
    const worker = async () => {
      while (i < todo.length && !this.disposed) {
        const sha = todo[i++]!
        try {
          await this.readBlob(sha)
          fetched++
        } catch (e) {
          if (isNetworkError(e)) return
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))
    if (fetched) this.emit()
    return fetched
  }

  // ---------------------------------------------------------------- editing

  hasDraft(path: string): boolean {
    return this.drafts.has(path)
  }

  /** Record an edit: persisted to IndexedDB immediately, committed by the auto-saver. */
  async editNote(path: string, content: string): Promise<void> {
    const existing = this.drafts.get(path)
    // Based on the displayed SHA: optimistic creates use the real git SHA, so they match once committed.
    const baseSha = existing ? existing.baseSha : (this.shaOf(path) ?? null)
    // Editing back to the saved content (e.g. undo) clears the draft.
    if (baseSha && baseSha === this.shaOf(path) && this.savedContent.get(path) === content) {
      if (existing) {
        this.clearDraft(path)
        this.emit()
      }
      return
    }
    const draft: Draft = { repoKey: this.repoKey, path, content, baseSha, updatedAt: Date.now() }
    this.drafts.set(path, draft)
    useRepo.setState((s) => (s.dirty[path] ? s : { dirty: { ...s.dirty, [path]: true } }))
    this.saver.notifyChange()
    await this.cache.putDraft(draft)
    this.emit()
  }

  private remoteSha(path: string): string | undefined {
    return this.remote?.entries.find((e) => e.path === path)?.sha
  }

  private clearDraft(path: string) {
    this.drafts.delete(path)
    useRepo.setState((s) => {
      if (!s.dirty[path]) return s
      const dirty = { ...s.dirty }
      delete dirty[path]
      return { dirty }
    })
    void this.cache.deleteDraft(this.repoKey, path)
  }

  /** Commit all drafts as one commit. Used by the auto-saver. */
  async flushDrafts(): Promise<{ remaining: number }> {
    const batch = [...this.drafts.values()]
    if (batch.length === 0) return { remaining: 0 }
    const changes: Change[] = batch.map((d) => ({ path: d.path, content: d.content, baseSha: d.baseSha }))
    const result = await this.commit(
      changes,
      describeChanges(
        'Update',
        batch.map((d) => d.path),
      ),
    )
    const written = new Map(result.written.map((w) => [w.content, w.sha]))
    for (const d of batch) {
      const current = this.drafts.get(d.path)
      if (!current) continue
      if (current.updatedAt === d.updatedAt) {
        this.clearDraft(d.path)
      } else {
        // Edited while saving: keep the newer draft, now based on what we just wrote.
        const conflicted = result.conflicts.some((c) => c.path === d.path)
        const newBase = conflicted
          ? (this.remoteSha(d.path) ?? null)
          : (written.get(d.content) ?? current.baseSha)
        current.baseSha = newBase
        await this.cache.putDraft(current)
      }
    }
    for (const c of result.conflicts) {
      notify(`"${c.path}" was changed elsewhere. Your version was saved as "${c.copyPath}".`, 'error')
    }
    this.emit()
    return { remaining: this.drafts.size }
  }

  /** Save pending drafts now; throws if some remain unsaved (e.g. offline). */
  async flushPending(): Promise<void> {
    if (this.drafts.size === 0) return
    await this.saver.saveNow()
    if (this.drafts.size > 0) {
      throw new Error(this.saver.lastError ?? 'Unsaved changes could not be saved.')
    }
  }

  // ---------------------------------------------------------------- committing

  /** Serialized commit on top of the latest remote snapshot. */
  commit(changes: Change[], message: string): Promise<CommitResult> {
    const run = async () => {
      if (!this.remote) throw new Error('Repository not loaded yet.')
      let result: CommitResult
      try {
        result = await commitChanges(this.client, this.remote, changes, message, { now: this.now })
      } catch (e) {
        if (isNetworkError(e)) useRepo.setState({ online: false })
        throw e
      }
      useRepo.setState({ online: true })
      await Promise.all(result.written.map((w) => this.cache.putBlob(w.sha, w.content)))
      for (const w of result.written) this.savedContent.set(w.path, w.content)
      await this.setRemote(result.snapshot, true)
      return result
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  /**
   * Commit a structural change (create/rename/delete) with optimistic UI:
   * the tree updates immediately and rolls back if the commit fails.
   */
  async applyOptimistic(changes: Change[], message: string, onApplied?: () => void): Promise<CommitResult> {
    const base = useRepo.getState().snapshot
    if (base) {
      const map = new Map(base.entries.map((e) => [e.path, e.sha]))
      for (const c of changes) {
        if (c.content === null) map.delete(c.path)
        else if (typeof c.content === 'object') map.set(c.path, c.content.sha)
        else {
          const sha = await gitBlobSha(c.content)
          await this.cache.putBlob(sha, c.content)
          map.set(c.path, sha)
        }
      }
      const optimistic = { ...base, entries: [...map].map(([path, sha]) => ({ path, sha })) }
      this.showSnapshot(optimistic)
      if (changes.some((c) => isMetaPath(c.path))) await this.loadMetas(optimistic)
    }
    onApplied?.()
    try {
      return await this.commit(changes, message)
    } catch (e) {
      if (this.remote) {
        this.showSnapshot(this.remote)
        await this.loadMetas(this.remote)
      }
      throw e
    }
  }
}
