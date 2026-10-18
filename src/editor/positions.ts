/** Where you were in each note (cursor + scroll), remembered per device so reopening a note returns there. */
export interface ViewPosition {
  /** Selection, as document offsets. */
  anchor: number
  head: number
  /** Document offset of the line at the top of the viewport, and how far (px) that line is scrolled past. */
  top: number
  topOffset: number
}

const KEY = 'wisp-notes:positions'
/** Oldest entries are dropped beyond this, so localStorage doesn't grow forever. */
export const MAX_POSITIONS = 300

function loadAll(): Record<string, ViewPosition> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, ViewPosition>) : {}
  } catch {
    return {}
  }
}

const isPos = (p: unknown): p is ViewPosition =>
  !!p &&
  typeof p === 'object' &&
  (['anchor', 'head', 'top', 'topOffset'] as const).every(
    (k) =>
      typeof (p as Record<string, unknown>)[k] === 'number' &&
      Number.isFinite((p as Record<string, number>)[k]),
  )

export function loadPosition(path: string): ViewPosition | undefined {
  const p = loadAll()[path]
  return isPos(p) ? p : undefined
}

export function savePosition(path: string, pos: ViewPosition): void {
  const all = loadAll()
  delete all[path] // re-insert last: object key order doubles as "least recently used first"
  all[path] = pos
  const keys = Object.keys(all)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_POSITIONS))) delete all[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Storage full or unavailable: losing the position is harmless.
  }
}
