import { isNotePath } from '../repo/paths.ts'
import type { RepoSession } from '../repo/session.ts'
import { useRepo } from '../repo/session.ts'
import { SearchIndex, type NoteSource } from './index.ts'

/**
 * Keeps a SearchIndex in sync with a RepoSession: background-prefetches all note blobs
 * into the cache (limited concurrency) and re-indexes incrementally on every change
 * (Drive syncs, drafts, saves). Works offline from the cache.
 */
export class SearchService {
  readonly index = new SearchIndex()
  /** Incremented whenever the index changes. */
  version = 0
  private session: RepoSession
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | null = null
  private again = false
  private disposed = false
  private unsubscribe: () => void
  private listeners = new Set<() => void>()

  constructor(session: RepoSession, opts: { prefetch?: boolean } = {}) {
    this.session = session
    this.unsubscribe = session.subscribe(() => this.schedule())
    this.schedule(0)
    if (opts.prefetch !== false) {
      // Let the UI settle first; cached notes are indexed immediately anyway.
      setTimeout(() => {
        if (!this.disposed) void session.prefetchNotes(4)
      }, 1500)
    }
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.unsubscribe()
    this.listeners.clear()
  }

  /** Notified after the index changed (to refresh open results). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private schedule(delay = 300) {
    if (this.disposed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.sync(), delay)
  }

  /** Re-index changed notes now. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        const entries = useRepo.getState().snapshot?.entries ?? []
        const notes: NoteSource[] = []
        for (const e of entries) {
          if (!isNotePath(e.path)) continue
          const draft = this.session.draftVersion(e.path)
          if (e.folder) continue
          const version = draft !== undefined ? `draft:${draft}` : (e.md5 ?? e.id)
          // Skip reading content that is already indexed at this version.
          if (this.index.isCurrent(e.path, version)) {
            notes.push({ path: e.path, version, content: '' })
            continue
          }
          notes.push({ path: e.path, version, content: await this.session.readCached(e.path) })
        }
        if (this.disposed) return
        if (this.index.update(notes) > 0) {
          this.version++
          for (const fn of this.listeners) fn()
        }
      } finally {
        this.running = null
      }
      if (this.again && !this.disposed) {
        this.again = false
        await this.sync()
      }
    })()
    return this.running
  }
}
