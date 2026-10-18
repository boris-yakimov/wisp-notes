import { findColorSpans } from '../repo/textColors.ts'

/**
 * Live-grep over note contents (like Telescope's live_grep): every line containing the query, literally.
 * Smart case: case-insensitive unless the query has an uppercase letter. Text color tags
 * (`<span style="color: …">`) are ignored, so they neither match nor show up in results.
 */

export interface GrepNote {
  path: string
  name: string
  icon: string | undefined
  /** Parent folder for display ("Work / Projects"). */
  parent: string
  content: string
}

export interface GrepHit {
  kind: 'line'
  path: string
  name: string
  icon: string | undefined
  parent: string
  /** 1-based line number. */
  line: number
  /** The line as shown (colors stripped, leading whitespace removed, long lines shortened). */
  text: string
  /** Indices of matched characters in `text`. */
  textMatches: number[]
  /** First match in the note's raw content (offsets), to select it when opening/previewing. */
  from: number
  to: number
  /** The matched text as written (for NoteNavState.highlight). */
  match: string
}

export interface GrepResult {
  hits: GrepHit[]
  /** Matching lines in total (hits are capped at `limit`). */
  total: number
}

/** Characters shown before the first match on long lines. */
const CONTEXT = 40
const MAX_TEXT = 240

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A line without color tags, and for each of its characters the index in the raw line. */
export function stripLine(line: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let pos = 0
  for (const s of findColorSpans(line)) {
    for (let i = pos; i < s.from; i++) map.push(i)
    for (let i = s.textFrom; i < s.textTo; i++) map.push(i)
    text += line.slice(pos, s.from) + line.slice(s.textFrom, s.textTo)
    pos = s.to
  }
  for (let i = pos; i < line.length; i++) map.push(i)
  text += line.slice(pos)
  return { text, map }
}

export function grepNotes(notes: GrepNote[], query: string, limit = 200): GrepResult {
  if (!query.trim()) return { hits: [], total: 0 }
  const caseSensitive = query !== query.toLowerCase()
  const flags = caseSensitive ? 'u' : 'iu'
  const re = new RegExp(escapeRegExp(query), 'g' + flags)
  // Separate non-global regex for the quick check (a global one's `test` moves `lastIndex`).
  const quick = new RegExp(escapeRegExp(query), flags)
  const hits: GrepHit[] = []
  let total = 0
  for (const note of notes) {
    let lineStart = 0
    const lines = note.content.split('\n')
    for (let n = 0; n < lines.length; n++) {
      const raw = lines[n]!
      const start = lineStart
      lineStart += raw.length + 1
      // Cheap check on the raw line first: a match in the stripped text is also one in the raw line
      // unless it spans a color tag boundary, which is rare enough to check only when tags are present.
      if (!quick.test(raw) && !raw.includes('<span')) continue
      const { text, map } = stripLine(raw)
      const found = [...text.matchAll(re)]
      if (!found.length) continue
      total++
      if (hits.length >= limit) continue
      const first = found[0]!
      // Shown text: no indentation, and long lines cut to start shortly before the first match.
      const lead = text.length - text.trimStart().length
      let cut = lead
      let prefix = ''
      if (first.index - lead > CONTEXT) {
        cut = first.index - CONTEXT
        prefix = '…'
      }
      let shown = text.slice(cut)
      let suffix = ''
      if (shown.length > MAX_TEXT) {
        shown = shown.slice(0, MAX_TEXT)
        suffix = '…'
      }
      const textMatches: number[] = []
      for (const m of found) {
        for (let i = m.index; i < m.index + m[0].length; i++) {
          const at = i - cut
          if (at >= 0 && at < shown.length) textMatches.push(at + prefix.length)
        }
      }
      const from = start + map[first.index]!
      const to = start + map[first.index + first[0].length - 1]! + 1
      hits.push({
        kind: 'line',
        path: note.path,
        name: note.name,
        icon: note.icon,
        parent: note.parent,
        line: n + 1,
        text: prefix + shown + suffix,
        textMatches,
        from,
        to,
        match: note.content.slice(from, to),
      })
    }
  }
  return { hits, total }
}
