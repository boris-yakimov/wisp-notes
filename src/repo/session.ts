import { create } from 'zustand'
import { Cache, type Draft } from '../cache/db.ts'
import type { DriveClient } from '../drive/client.ts'
import { DriveError, isAuthError, isNetworkError, toDriveError } from '../drive/errors.ts'
import { md5Hex } from '../drive/md5.ts'
import { RemoteTree, type Entry } from '../drive/remoteTree.ts'
import { applyOpsToEntries, executeOps, type DriveOp, type ExecResult } from './apply.ts'
import { AutoSaver, type SaveStatus } from './autosave.ts'
import { importOp, type ImportFile } from './ops.ts'
import { dirname, isMetaPath, isNotePath } from './paths.ts'
import { parseMeta, type FolderMeta } from './tree.ts'

export interface Notice {
  id: number
  kind: 'info' | 'error'
  message: string
}

/** What the UI shows: remote state plus optimistic, not-yet-confirmed operations. */
export interface View {
  entries: Entry[]
}

/** Reactive state for the UI. Mutated only by RepoSession. */
export interface RepoState {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  online: boolean
  /** True when Google access expired and the user must click "Sign in". */
  authRequired: boolean
  snapshot: View | null
  metas: Record<string, FolderMeta>
  /** Paths with unsaved edits. */
  dirty: Record<string, true>
  saveStatus: SaveStatus
  saveError: string | null
  importing: { done: number; total: number } | null
  notices: Notice[]
}

const initialState: RepoState = {
  phase: 'idle',
  error: null,
  online: true,
  authRequired: false,
  snapshot: null,
  metas: {},
  dirty: {},
  saveStatus: 'saved',
  saveError: null,
  importing: null,
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
 * The signed-in user's notes in Google Drive. Owns the Drive client, IndexedDB cache, drafts and
 * the auto-saver, and serializes all Drive syncs and writes. Exposes reactive state via `useRepo`.
 */
export class RepoSession {
  readonly saver: AutoSaver
  /** Last state confirmed by Drive. */
  private remote: RemoteTree | null = null
  /** Currently displayed entries by path. */
  private shown = new Map<string, Entry>()
  private drafts = new Map<string, Draft>()
  /** Last saved content of notes read/written this session (path → content), for undo detection. */
  private savedContent = new Map<string, string>()
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<Listener>()
  private disposed = false
  private now: () => Date
  /** Object URLs of repo files (images), by content hash. */
  private fileUrls = new Map<string, Promise<string>>()

  readonly client: DriveClient
  readonly cache: Cache
  readonly repoKey: string

  constructor(client: DriveClient, cache: Cache, repoKey: string, opts: SessionOptions = {}) {
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
    for (const u of this.fileUrls.values()) void u.then(URL.revokeObjectURL, () => undefined)
    this.fileUrls.clear()
    this.saver.dispose()
    this.listeners.clear()
  }

  /** Subscribe to content/structure changes (e.g. the search index). */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  /** Run Drive work one at a time (syncs and writes never interleave). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn)
    this.queue = p.catch(() => undefined)
    return p
  }

  private noteError(e: unknown) {
    if (isNetworkError(e)) useRepo.setState({ online: false })
    else if (isAuthError(e)) useRepo.setState({ authRequired: true })
  }

  // ---------------------------------------------------------------- loading

  /** Show cached state instantly, restore drafts, then fetch the latest state from Drive. */
  async start(): Promise<void> {
    useRepo.setState({ phase: 'loading' })
    const [cached, drafts] = await Promise.all([
      this.cache.getSnapshot(this.repoKey),
      this.cache.getDrafts(this.repoKey),
    ])
    this.drafts = new Map(drafts.map((d) => [d.path, d]))
    useRepo.setState({ dirty: Object.fromEntries(drafts.map((d) => [d.path, true as const])) })
    if (cached) {
      await this.setRemote(new RemoteTree(cached), false)
      useRepo.setState({ phase: 'ready' })
    }
    await this.revalidate()
    if (this.drafts.size > 0 && !this.disposed) void this.saver.saveNow()
  }

  /** Fetch Drive changes since the last sync (or everything on first use). */
  async revalidate(): Promise<void> {
    try {
      await this.enqueue(() => this.pull())
      useRepo.setState({ phase: 'ready', error: null, online: true, authRequired: false })
    } catch (e) {
      const err = toDriveError(e)
      this.noteError(err)
      if (!this.remote && err.kind !== 'auth') {
        useRepo.setState({
          phase: 'error',
          error:
            err.kind === 'network'
              ? 'You are offline and no copy of your notes is stored on this device yet.'
              : err.message,
        })
      } else if (err.kind !== 'network' && err.kind !== 'auth') {
        notify(`Could not refresh: ${err.message}`, 'error')
      }
    }
  }

  /** Bring `remote` up to date. Must run inside the queue. */
  private async pull(): Promise<void> {
    const remote = this.remote
    if (remote?.changeToken) {
      try {
        const { changes, nextToken } = await this.client.listChanges(remote.changeToken)
        if (!changes.length && nextToken === remote.changeToken) return
        const tree = remote.clone()
        tree.applyChanges(changes)
        tree.changeToken = nextToken
        await this.setRemote(tree, true)
        return
      } catch (e) {
        const err = toDriveError(e)
        if (err.kind === 'network' || err.kind === 'auth') throw err
        // Invalid/expired token: fall back to a full listing.
      }
    }
    const rootId = remote?.rootId ?? (await this.client.ensureRoot())
    const changeToken = await this.client.getStartPageToken() // before listing: no change is missed
    const items = await this.client.listAll()
    await this.setRemote(new RemoteTree({ rootId, changeToken, items }), true)
  }

  private async setRemote(tree: RemoteTree, persist: boolean): Promise<void> {
    this.remote = tree
    this.show(tree.entries())
    if (persist) await this.cache.putSnapshot(this.repoKey, tree.toState())
    await this.loadMetas()
  }

  private show(entries: Entry[]) {
    this.shown = new Map(entries.map((e) => [e.path, e]))
    useRepo.setState({ snapshot: { entries } })
    this.emit()
  }

  private async loadMetas(): Promise<void> {
    const view = useRepo.getState().snapshot
    const metas: Record<string, FolderMeta> = {}
    await Promise.all(
      [...this.shown.values()]
        .filter((e) => !e.folder && isMetaPath(e.path))
        .map(async (e) => {
          try {
            metas[dirname(e.path)] = parseMeta(await this.readEntry(e))
          } catch {
            /* offline and not cached: default icon */
          }
        }),
    )
    if (useRepo.getState().snapshot === view) useRepo.setState({ metas })
  }

  // ---------------------------------------------------------------- reading

  /** Content hash of a displayed file. */
  shaOf(path: string): string | undefined {
    return this.shown.get(path)?.md5
  }

  exists(path: string): boolean {
    return this.shown.has(path)
  }

  /** File content: IndexedDB by hash first, else download from Drive (and cache it). */
  private async readEntry(e: Entry): Promise<string> {
    if (e.md5) {
      const cached = await this.cache.getBlob(e.md5)
      if (cached !== undefined) return cached
    }
    if (e.id.startsWith('pending:')) throw new DriveError('not-found', 'The file is still being created.')
    const content = await this.client.download(e.id)
    await this.cache.putBlob(md5Hex(content), content)
    return content
  }

  /**
   * Object URL for a file in the repo (an image or attachment), from the device cache or Drive.
   * URLs are reused per content hash and revoked when the session ends.
   */
  fileUrl(path: string): Promise<string> {
    const e = this.shown.get(path)
    if (!e || e.folder) return Promise.reject(new DriveError('not-found', `"${path}" does not exist.`))
    const key = e.md5 ?? e.id
    let url = this.fileUrls.get(key)
    if (!url) {
      url = (async () => {
        let blob = e.md5 ? await this.cache.getFile(e.md5) : undefined
        if (!blob) {
          if (e.id.startsWith('pending:'))
            throw new DriveError('not-found', 'The file is still being uploaded.')
          blob = await this.client.downloadBlob(e.id)
          if (e.md5) await this.cache.putFile(e.md5, blob)
        }
        return URL.createObjectURL(blob)
      })()
      this.fileUrls.set(key, url)
      url.catch(() => this.fileUrls.delete(key))
    }
    return url
  }

  /** Cached content only (no network). */
  async readCached(path: string): Promise<string | undefined> {
    const d = this.drafts.get(path)
    if (d) return d.content
    const md5 = this.shown.get(path)?.md5
    return md5 ? this.cache.getBlob(md5) : undefined
  }

  /** Current content of a note: unsaved draft, else the file. */
  async readNote(path: string): Promise<string> {
    const d = this.drafts.get(path)
    if (d) return d.content
    const e = this.shown.get(path)
    if (!e || e.folder) throw new DriveError('not-found', `Note "${path}" does not exist.`)
    try {
      const content = await this.readEntry(e)
      this.savedContent.set(path, content)
      return content
    } catch (err) {
      this.noteError(err)
      if (isNetworkError(err)) throw new DriveError('network', 'This note is not available offline yet.')
      if (isAuthError(err)) throw new DriveError('auth', 'Sign in again to load this note.')
      throw err
    }
  }

  /** Download all uncached notes (limited concurrency). Returns the number fetched. */
  async prefetchNotes(concurrency = 4): Promise<number> {
    if (!this.remote) return 0
    const notes = this.remote.entries().filter((e) => !e.folder && e.md5 && isNotePath(e.path))
    const cached = await this.cache.cachedShas(notes.map((e) => e.md5!))
    const todo = notes.filter((e) => !cached.has(e.md5!))
    let i = 0
    let fetched = 0
    const worker = async () => {
      while (i < todo.length && !this.disposed) {
        const e = todo[i++]!
        try {
          await this.readEntry(e)
          fetched++
        } catch (err) {
          if (isNetworkError(err) || isAuthError(err)) return
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

  /** Timestamp of the unsaved draft for a path, if any (changes on every edit). */
  draftVersion(path: string): number | undefined {
    return this.drafts.get(path)?.updatedAt
  }

  /** Record an edit: persisted to IndexedDB immediately, saved to Drive by the auto-saver. */
  async editNote(path: string, content: string): Promise<void> {
    const existing = this.drafts.get(path)
    const baseHash = existing ? existing.baseHash : (this.shaOf(path) ?? null)
    // Editing back to the saved content (e.g. undo) clears the draft.
    if (baseHash && baseHash === this.shaOf(path) && this.savedContent.get(path) === content) {
      if (existing) {
        this.clearDraft(path)
        this.emit()
      }
      return
    }
    const draft: Draft = { repoKey: this.repoKey, path, content, baseHash, updatedAt: Date.now() }
    this.drafts.set(path, draft)
    useRepo.setState((s) => (s.dirty[path] ? s : { dirty: { ...s.dirty, [path]: true } }))
    this.saver.notifyChange()
    await this.cache.putDraft(draft)
    this.emit()
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

  /** Save all drafts to Drive in one batch. Used by the auto-saver. */
  async flushDrafts(): Promise<{ remaining: number }> {
    const batch = [...this.drafts.values()]
    if (batch.length === 0) return { remaining: 0 }
    const ops: DriveOp[] = batch.map((d) => ({
      kind: 'write',
      path: d.path,
      content: d.content,
      base: d.baseHash,
    }))
    const result = await this.run(ops)
    const saved = new Set(result.saved)
    const conflicted = new Set(result.conflicts.map((c) => c.path))
    for (const d of batch) {
      const current = this.drafts.get(d.path)
      if (!current || !saved.has(d.path)) continue
      if (current.updatedAt === d.updatedAt) {
        this.clearDraft(d.path)
      } else {
        // Edited while saving: keep the newer draft, now based on what is in Drive.
        current.baseHash = conflicted.has(d.path) ? (this.shaOf(d.path) ?? null) : md5Hex(d.content)
        await this.cache.putDraft(current)
      }
    }
    for (const c of result.conflicts) {
      notify(`"${c.path}" was changed on another device. Your version was saved as "${c.copyPath}".`, 'error')
    }
    this.emit()
    if (result.error) throw result.error
    return { remaining: this.drafts.size }
  }

  /** Save pending drafts now; throws if some remain unsaved (e.g. offline). */
  async flushPending(): Promise<void> {
    if (this.drafts.size === 0) return
    await this.saver.saveNow()
    if (this.drafts.size > 0) throw new Error(this.saver.lastError ?? 'Unsaved changes could not be saved.')
  }

  // ---------------------------------------------------------------- writing

  /**
   * Serialized: fetch the latest Drive state, then execute ops on it. Partial progress is kept
   * (remote state reflects what succeeded); the first failure is returned in `result.error`.
   */
  run(
    ops: DriveOp[],
    opts: { onProgress?: (done: number, total: number) => void } = {},
  ): Promise<ExecResult> {
    return this.enqueue(async () => {
      try {
        await this.pull()
      } catch (e) {
        this.noteError(e)
        throw e
      }
      const tree = this.remote!.clone()
      const result = await executeOps(this.client, tree, ops, { now: this.now, onProgress: opts.onProgress })
      if (result.error) this.noteError(result.error)
      else useRepo.setState({ online: true, authRequired: false })
      await Promise.all(result.written.map((w) => this.cache.putBlob(w.md5, w.content)))
      for (const w of result.written) this.savedContent.set(w.path, w.content)
      await this.setRemote(tree, true)
      return result
    })
  }

  /**
   * Structural change (create/rename/delete/icon) with optimistic UI: the tree updates immediately
   * and rolls back to the real Drive state if the operation fails.
   */
  async applyOptimistic(ops: DriveOp[], onApplied?: () => void): Promise<ExecResult> {
    const view = useRepo.getState().snapshot
    if (view) {
      for (const op of ops) {
        if (op.kind === 'write' && typeof op.content === 'string') {
          await this.cache.putBlob(md5Hex(op.content), op.content)
        }
      }
      this.show(applyOpsToEntries(view.entries, ops))
      if (ops.some((o) => isMetaPath(o.path))) await this.loadMetas()
    }
    onApplied?.()
    let result: ExecResult
    try {
      result = await this.run(ops)
    } catch (e) {
      if (this.remote) await this.setRemote(this.remote, false)
      throw e
    }
    if (result.error) throw result.error
    return result
  }

  /** Upload local files into a folder (keeping structure). Returns the number of files imported. */
  async importFiles(folder: string, files: ImportFile[]): Promise<{ imported: number; failed: boolean }> {
    const op = importOp(folder, files, this.remote?.entries() ?? [])
    if (!op.ops.length) return { imported: 0, failed: false }
    useRepo.setState({ importing: { done: 0, total: op.ops.length } })
    try {
      const result = await this.run(op.ops, {
        onProgress: (done, total) => useRepo.setState({ importing: { done, total } }),
      })
      return { imported: result.saved.length, failed: !!result.error }
    } finally {
      useRepo.setState({ importing: null })
    }
  }
}
