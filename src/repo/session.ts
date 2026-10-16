import { create } from 'zustand'
import { Cache, type Draft } from '../cache/db.ts'
import type { DriveClient } from '../drive/client.ts'
import { DriveError, isAuthError, isNetworkError, toDriveError } from '../drive/errors.ts'
import { md5Hex } from '../drive/md5.ts'
import { RemoteTree, type Entry } from '../drive/remoteTree.ts'
import { applyOpsToEntries, executeOps, type DriveOp, type ExecResult } from './apply.ts'
import { AutoSaver, type SaveStatus } from './autosave.ts'
import { importOp, MAX_PASTED_IMAGE, pastedImage, pastedImageExt, type ImportFile } from './ops.ts'
import { dirname, isInside, isMetaPath, isNotePath } from './paths.ts'
import { parseMeta, type FolderMeta } from './tree.ts'

/** Save a draft, with a conflict check against the content it was based on. */
const draftWrite = (d: Draft): DriveOp => ({
  kind: 'write',
  path: d.path,
  content: d.content,
  base: d.baseHash,
})

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
  /**
   * Optimistic operations not yet confirmed by Drive. Always shown on top of `remote`, so syncs that
   * run while they are in flight don't make the tree jump back to the old state.
   */
  private pending: DriveOp[][] = []
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
  /** Files added on this device (pasted images): shown at once, before and after the upload. */
  private localFiles = new Map<string, Blob>()

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
    this.show()
    if (persist) await this.cache.putSnapshot(this.repoKey, tree.toState())
    await this.loadMetas()
  }

  /** Display the remote state plus pending optimistic operations. */
  private show() {
    const remote = this.remote?.entries() ?? []
    const entries = this.pending.length ? applyOpsToEntries(remote, this.pending.flat()) : remote
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
    const local = this.localFiles.get(path)
    const key = local ? `local:${path}` : (e.md5 ?? e.id)
    let url = this.fileUrls.get(key)
    if (!url) {
      url = (async () => {
        let blob = local ?? (e.md5 ? await this.cache.getFile(e.md5) : undefined)
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

  /**
   * Store a pasted image next to the note (in its sub-note folder) and return the Markdown that shows
   * it. The image is visible at once; the upload runs in the background (`done`).
   */
  pasteImage(notePath: string, image: Blob): { markdown: string; done: Promise<void> } {
    const ext = pastedImageExt(image.type)
    if (!ext) throw new DriveError('unknown', 'Only PNG, JPEG, GIF and WebP images can be pasted.')
    if (image.size > MAX_PASTED_IMAGE) throw new DriveError('unknown', 'The image is too large (max 20 MB).')
    const entries = useRepo.getState().snapshot?.entries ?? []
    const { path, markdown } = pastedImage(notePath, ext, this.now(), entries)
    this.localFiles.set(path, image)
    const done = (async () => {
      await this.applyOptimistic([{ kind: 'write', path, content: image, base: null }])
      const md5 = this.shown.get(path)?.md5
      if (md5) await this.cache.putFile(md5, image) // available offline on this device too
    })()
    return { markdown, done }
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
    if (this.drafts.size === 0) return { remaining: 0 }
    // The batch is taken when the save actually runs (in the queue), after earlier operations such
    // as a move, which may have saved or relocated some drafts already.
    let batch: Draft[] = []
    const result = await this.run(() => {
      batch = [...this.drafts.values()]
      return batch.map(draftWrite)
    })
    await this.settleDrafts(batch, result)
    this.emit()
    if (result.error) throw result.error
    return { remaining: this.drafts.size }
  }

  /** After drafts were written: clear the saved ones, rebase those edited while saving, report conflicts. */
  private async settleDrafts(batch: Draft[], result: ExecResult): Promise<void> {
    const saved = new Set(result.saved)
    const conflicts = result.conflicts.filter((c) => batch.some((d) => d.path === c.path))
    const conflicted = new Set(conflicts.map((c) => c.path))
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
    for (const c of conflicts) {
      notify(`"${c.path}" was changed on another device. Your version was saved as "${c.copyPath}".`, 'error')
    }
  }

  // ---------------------------------------------------------------- writing

  /**
   * Serialized: fetch the latest Drive state, then execute ops on it. Partial progress is kept
   * (remote state reflects what succeeded); the first failure is returned in `result.error`.
   * `ops` may be a function, called right before execution (inside the queue). `overlay` is the
   * optimistic batch these ops confirm: it stays displayed until the result is shown.
   */
  run(
    ops: DriveOp[] | (() => DriveOp[]),
    opts: { onProgress?: (done: number, total: number) => void; overlay?: DriveOp[] } = {},
  ): Promise<ExecResult> {
    return this.enqueue(async () => {
      const settle = () => {
        if (opts.overlay) this.pending = this.pending.filter((p) => p !== opts.overlay)
      }
      let tree: RemoteTree
      let result: ExecResult
      try {
        try {
          await this.pull()
        } catch (e) {
          this.noteError(e)
          throw e
        }
        const list = typeof ops === 'function' ? ops() : ops
        tree = this.remote!.clone()
        result = list.length
          ? await executeOps(this.client, tree, list, { now: this.now, onProgress: opts.onProgress })
          : { conflicts: [], written: [], saved: [] }
        if (result.error) this.noteError(result.error)
        else useRepo.setState({ online: true, authRequired: false })
        await Promise.all(result.written.map((w) => this.cache.putBlob(w.md5, w.content)))
        for (const w of result.written) this.savedContent.set(w.path, w.content)
      } catch (e) {
        settle()
        if (this.remote) await this.setRemote(this.remote, false) // roll back the optimistic view
        throw e
      }
      settle()
      await this.setRemote(tree, true)
      return result
    })
  }

  /**
   * Structural change (create/rename/move/delete/icon) with optimistic UI: the tree updates
   * immediately, Drive is updated in the background, and the view rolls back to the real Drive
   * state if the operation fails. Unsaved edits of notes being moved or deleted are saved in the
   * same batch, right before the move/delete, so the operation never waits for a separate save.
   */
  async applyOptimistic(ops: DriveOp[], onApplied?: () => void): Promise<ExecResult> {
    const affected = (d: Draft) =>
      ops.some((o) => (o.kind === 'rename' || o.kind === 'trash') && isInside(d.path, o.path))
    const overlay = [...[...this.drafts.values()].filter(affected).map(draftWrite), ...ops]
    for (const op of overlay) {
      if (op.kind === 'write' && typeof op.content === 'string') {
        await this.cache.putBlob(md5Hex(op.content), op.content)
      }
    }
    if (this.remote) {
      this.pending.push(overlay)
      this.show()
      if (ops.some((o) => isMetaPath(o.path))) await this.loadMetas()
    }
    onApplied?.()
    let batch: Draft[] = []
    const result = await this.run(
      () => {
        // Taken when the batch runs: an earlier save may have stored some of these drafts already.
        batch = [...this.drafts.values()].filter(affected)
        return [...batch.map(draftWrite), ...ops]
      },
      { overlay },
    )
    if (batch.length) {
      await this.settleDrafts(batch, result)
      this.emit()
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
