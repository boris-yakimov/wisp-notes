import { isNetworkError } from '../github/errors.ts'

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'offline' | 'error'

export interface FlushOutcome {
  /** Number of drafts still dirty after the flush (edited while saving). */
  remaining: number
}

export interface AutoSaverOptions {
  /** Commit after this much idle time since the last change. */
  idleMs?: number
  /** While typing continuously, commit at least this often. */
  maxMs?: number
  /** Retry delays grow exponentially from this value... */
  retryBaseMs?: number
  /** ...up to this cap. */
  retryMaxMs?: number
}

/**
 * Debounced save scheduler. Knows nothing about GitHub: `flush` does the work
 * (batch all dirty drafts into one commit). Handles idle debounce, max interval,
 * serialization (never two flushes at once) and retry with exponential backoff.
 */
export class AutoSaver {
  readonly idleMs: number
  readonly maxMs: number
  private retryBaseMs: number
  private retryMaxMs: number
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private maxTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private failures = 0
  private running: Promise<void> | undefined
  private rerun = false
  private pending = false
  private disposed = false
  status: SaveStatus = 'saved'
  lastError: string | null = null

  private flush: () => Promise<FlushOutcome>
  private onStatus: (status: SaveStatus, error: string | null) => void

  constructor(
    flush: () => Promise<FlushOutcome>,
    onStatus: (status: SaveStatus, error: string | null) => void = () => {},
    opts: AutoSaverOptions = {},
  ) {
    this.flush = flush
    this.onStatus = onStatus
    this.idleMs = opts.idleMs ?? 3000
    this.maxMs = opts.maxMs ?? 45_000
    this.retryBaseMs = opts.retryBaseMs ?? 2000
    this.retryMaxMs = opts.retryMaxMs ?? 60_000
  }

  /** True while there are changes not yet committed. */
  get hasPending(): boolean {
    return this.pending || this.status === 'saving'
  }

  /** Call on every edit. */
  notifyChange(): void {
    if (this.disposed) return
    this.pending = true
    if (this.status !== 'saving' && this.status !== 'offline' && this.status !== 'error') {
      this.setStatus('unsaved')
    }
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => void this.run(), this.idleMs)
    this.maxTimer ??= setTimeout(() => void this.run(), this.maxMs)
  }

  /** Save immediately (Ctrl+S, :w, before operations, back online). */
  saveNow(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.pending = true
    return this.run()
  }

  dispose(): void {
    this.disposed = true
    this.clearTimers()
    clearTimeout(this.retryTimer)
  }

  private clearTimers() {
    clearTimeout(this.idleTimer)
    clearTimeout(this.maxTimer)
    this.idleTimer = undefined
    this.maxTimer = undefined
  }

  private setStatus(s: SaveStatus, err: string | null = null) {
    this.status = s
    this.lastError = err
    this.onStatus(s, err)
  }

  private run(): Promise<void> {
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.clearTimers()
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.running = (async () => {
      this.pending = false
      this.setStatus('saving')
      try {
        const { remaining } = await this.flush()
        this.failures = 0
        if (remaining > 0) this.pending = true
        if (this.pending && !this.rerun) {
          this.setStatus('unsaved')
          this.notifyChange()
        } else if (!this.pending) {
          this.setStatus('saved')
        }
      } catch (e) {
        this.pending = true
        const offline = isNetworkError(e)
        this.setStatus(offline ? 'offline' : 'error', (e as Error).message)
        const delay = Math.min(this.retryBaseMs * 2 ** this.failures, this.retryMaxMs)
        this.failures++
        if (!this.disposed) this.retryTimer = setTimeout(() => void this.run(), delay)
      } finally {
        this.running = undefined
      }
      if (this.rerun && !this.disposed) {
        this.rerun = false
        await this.run()
      }
    })()
    return this.running
  }
}
