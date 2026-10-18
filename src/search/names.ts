import { dirname, displayPath } from '../repo/paths.ts'
import type { FolderNode, NoteNode } from '../repo/tree.ts'

/**
 * Fuzzy search over note and folder names (not contents), for the quick-open palette.
 *
 * Each whitespace-separated query term must match the item's name, or else its parent path
 * (so "work road" finds "Work / Roadmap"). A term matches as a substring anywhere in the name
 * ("oadm" → "Roadmap"), or failing that as a subsequence ("rdmp" → "Roadmap"). Substring matches,
 * matches at the start of the name or of a word, and shorter names rank higher.
 */

export interface NameHit {
  kind: 'note' | 'folder'
  path: string
  name: string
  icon: string | undefined
  /** Parent folder for display ("Work / Projects"), '' at the top level. */
  parent: string
  score: number
  /** Indices of matched characters in `name`, for highlighting. */
  nameMatches: number[]
  /** Indices of matched characters in `parent`, for highlighting. */
  parentMatches: number[]
}

interface Match {
  score: number
  indices: number[]
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

/** Start of the text or of a word ("road" in "Big Roadmap", "Map" in "roadMap"). */
function atBoundary(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]!
  const cur = text[i]!
  if (!isWordChar(prev)) return true
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase() // camelCase
}

/** Match one lowercase `term` against `text`; null if it doesn't match. */
export function matchTerm(text: string, term: string): Match | null {
  if (!term) return { score: 0, indices: [] }
  const lower = text.toLowerCase()
  const range = (from: number) => Array.from({ length: term.length }, (_, k) => from + k)

  // Substring: prefer a match at a word boundary over the first occurrence.
  let at = -1
  for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + 1)) {
    if (at === -1) at = i
    if (atBoundary(text, i)) {
      at = i
      break
    }
  }
  if (at !== -1) {
    let score = 1000
    if (term.length === lower.length) score += 500
    else if (at === 0) score += 300
    else if (atBoundary(text, at)) score += 150
    score -= Math.min(at, 50) + (lower.length - term.length) * 0.5
    return { score, indices: range(at) }
  }

  // Subsequence: greedy, but each character prefers a word start if one comes before the next plain hit.
  const indices: number[] = []
  let from = 0
  for (const ch of term) {
    let i = lower.indexOf(ch, from)
    if (i === -1) return null
    for (let j = i; j !== -1; j = lower.indexOf(ch, j + 1)) {
      if (atBoundary(text, j)) {
        // Only jump ahead if the rest of the term still fits afterwards.
        if (j !== i && isSubsequence(lower, term.slice(indices.length + 1), j + 1)) i = j
        break
      }
    }
    indices.push(i)
    from = i + 1
  }
  let score = 500
  for (let k = 0; k < indices.length; k++) {
    if (atBoundary(text, indices[k]!)) score += 20
    if (k > 0) score -= Math.min(indices[k]! - indices[k - 1]! - 1, 10) * 5 // gaps
  }
  score -= Math.min(indices[0]!, 50) + (lower.length - term.length) * 0.5
  return { score, indices }
}

function isSubsequence(text: string, sub: string, from: number): boolean {
  for (const ch of sub) {
    const i = text.indexOf(ch, from)
    if (i === -1) return false
    from = i + 1
  }
  return true
}

/** All notes and folders in the tree (a note's sub-note folder is part of the note, not listed). */
export function listItems(root: FolderNode): (FolderNode | NoteNode)[] {
  const out: (FolderNode | NoteNode)[] = []
  const walk = (f: FolderNode) => {
    for (const item of f.items) {
      out.push(item)
      const inner = item.kind === 'folder' ? item : item.children
      if (inner) walk(inner)
    }
  }
  walk(root)
  return out
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function searchNames(root: FolderNode, query: string, limit = 50): NameHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const hits: NameHit[] = []
  for (const item of listItems(root)) {
    const parent = displayPath(dirname(item.path))
    let score = 0
    const nameMatches = new Set<number>()
    const parentMatches = new Set<number>()
    let ok = true
    for (const t of terms) {
      const inName = matchTerm(item.name, t)
      if (inName) {
        score += inName.score
        inName.indices.forEach((i) => nameMatches.add(i))
        continue
      }
      const inParent = parent ? matchTerm(parent, t) : null
      if (!inParent) {
        ok = false
        break
      }
      score += inParent.score * 0.3 // matching the folder path counts less than the name
      inParent.indices.forEach((i) => parentMatches.add(i))
    }
    if (!ok) continue
    hits.push({
      kind: item.kind,
      path: item.path,
      name: item.name,
      icon: item.icon,
      parent,
      score,
      nameMatches: [...nameMatches].sort((a, b) => a - b),
      parentMatches: [...parentMatches].sort((a, b) => a - b),
    })
  }
  return hits
    .sort((a, b) => b.score - a.score || collator.compare(a.name, b.name) || a.path.length - b.path.length)
    .slice(0, limit)
}

/** Split `text` into runs, marking the characters at `indices`. */
export function markRuns(text: string, indices: number[]): { text: string; match: boolean }[] {
  const set = new Set(indices)
  const runs: { text: string; match: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const match = set.has(i)
    const last = runs[runs.length - 1]
    if (last && last.match === match) last.text += text[i]
    else runs.push({ text: text[i]!, match })
  }
  return runs
}
