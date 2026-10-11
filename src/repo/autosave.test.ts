import { AutoSaver } from './autosave.ts'
import { GitHubError } from '../github/errors.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(flushImpl: () => Promise<{ remaining: number }> = async () => ({ remaining: 0 })) {
  const flush = vi.fn(flushImpl)
  const statuses: string[] = []
  const saver = new AutoSaver(flush, (s) => statuses.push(s), {
    idleMs: 3000,
    maxMs: 45_000,
    retryBaseMs: 1000,
  })
  return { saver, flush, statuses }
}

describe('AutoSaver', () => {
  it('saves after 3s idle', async () => {
    const { saver, flush, statuses } = setup()
    saver.notifyChange()
    expect(saver.status).toBe('unsaved')
    await vi.advanceTimersByTimeAsync(2999)
    expect(flush).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(['unsaved', 'saving', 'saved'])
  })

  it('debounces bursts of changes into one save', async () => {
    const { saver, flush } = setup()
    for (let i = 0; i < 5; i++) {
      saver.notifyChange()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(flush).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('saves at least every 45s while typing continuously', async () => {
    const { saver, flush } = setup()
    for (let t = 0; t < 46_000; t += 1000) {
      saver.notifyChange()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('saveNow saves immediately and never runs two flushes concurrently', async () => {
    let resolve!: () => void
    const { saver, flush } = setup(() => new Promise((r) => (resolve = () => r({ remaining: 0 }))))
    const p1 = saver.saveNow()
    const p2 = saver.saveNow()
    expect(flush).toHaveBeenCalledTimes(1)
    resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(flush).toHaveBeenCalledTimes(2) // queued re-run, after the first finished
    resolve()
    await Promise.all([p1, p2])
    expect(saver.status).toBe('saved')
  })

  it('retries with exponential backoff when offline', async () => {
    let fail = 3
    const { saver, flush } = setup(async () => {
      if (fail-- > 0) throw new GitHubError('network', 'offline')
      return { remaining: 0 }
    })
    await saver.saveNow()
    expect(saver.status).toBe('offline')
    await vi.advanceTimersByTimeAsync(1000) // retry 1
    expect(flush).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1999)
    expect(flush).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1) // retry 2 after 2s
    expect(flush).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(4000) // retry 3 after 4s
    expect(flush).toHaveBeenCalledTimes(4)
    expect(saver.status).toBe('saved')
  })

  it('reports error status for non-network failures and keeps retrying', async () => {
    let fail = true
    const { saver } = setup(async () => {
      if (fail) throw new GitHubError('forbidden', 'nope')
      return { remaining: 0 }
    })
    await saver.saveNow()
    expect(saver.status).toBe('error')
    expect(saver.lastError).toBe('nope')
    fail = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.status).toBe('saved')
  })

  it('schedules another save when edits happened during a save', async () => {
    let calls = 0
    const { saver, flush } = setup(async () => ({ remaining: calls++ === 0 ? 1 : 0 }))
    await saver.saveNow()
    expect(saver.status).toBe('unsaved')
    expect(saver.hasPending).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(flush).toHaveBeenCalledTimes(2)
    expect(saver.status).toBe('saved')
  })
})
