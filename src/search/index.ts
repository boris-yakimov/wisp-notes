import MiniSearch from 'minisearch'
import { isHidden, isNotePath, noteTitle } from '../repo/paths.ts'

/**
 * Full-text index over notes (title, path, content) built with MiniSearch.
 * Updated incrementally: `update` only (re)indexes notes whose content version changed.
 */

interface Doc {
  id: string // path
  title: string
  path: string
  content: string
}

export interface SearchHit {
  path: string
  title: string
  score: number
  /** Matched document terms (lowercase), for highlighting. */
  terms: string[]
  /** Short excerpt around the first content match, or null if only title/path matched. */
  snippet: { text: string; matchStart: number; matchEnd: number } | null
}

export interface NoteSource {
  path: string
  /** Changes whenever content changes (blob SHA, or draft timestamp). */
  version: string
  /** Content if available locally (cache/draft); undefined → index title/path only. */
  content: string | undefined
}

const tokenize = (text: string) => text.split(/[\s\p{P}\p{S}]+/u).filter(Boolean)

export class SearchIndex {
  private mini = new MiniSearch<Doc>({
    fields: ['title', 'path', 'content'],
    storeFields: ['title', 'path'],
    tokenize,
    processTerm: (t) => t.toLowerCase(),
    searchOptions: {
      boost: { title: 4, path: 1.5, content: 1 },
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
      combineWith: 'AND',
    },
  })
  private versions = new Map<string, string>()
  private contents = new Map<string, string>()

  get size(): number {
    return this.versions.size
  }

  /** Bring the index in sync with the given notes. Returns the number of documents (re)indexed. */
  update(notes: NoteSource[]): number {
    const seen = new Set<string>()
    let changed = 0
    for (const n of notes) {
      if (!isNotePath(n.path) || isHidden(n.path)) continue
      seen.add(n.path)
      const version = n.content === undefined ? `${n.version}:pending` : n.version
      if (this.versions.get(n.path) === version) continue
      const doc: Doc = { id: n.path, title: noteTitle(n.path), path: n.path, content: n.content ?? '' }
      if (this.mini.has(n.path)) this.mini.replace(doc)
      else this.mini.add(doc)
      this.versions.set(n.path, version)
      this.contents.set(n.path, doc.content)
      changed++
    }
    for (const path of [...this.versions.keys()]) {
      if (!seen.has(path)) {
        this.mini.discard(path)
        this.versions.delete(path)
        this.contents.delete(path)
        changed++
      }
    }
    return changed
  }

  /** True if this note's content is already indexed at this version. */
  isCurrent(path: string, version: string): boolean {
    return this.versions.get(path) === version
  }

  search(query: string, limit = 50): SearchHit[] {
    const q = query.trim()
    if (!q) return []
    return this.mini
      .search(q)
      .slice(0, limit)
      .map((r) => {
        const path = r.id as string
        const content = this.contents.get(path) ?? ''
        return {
          path,
          title: r.title as string,
          score: r.score,
          terms: r.terms,
          snippet: Object.values(r.match).some((fields) => fields.includes('content'))
            ? makeSnippet(content, r.terms)
            : null,
        }
      })
  }
}

/** Excerpt (~120 chars) around the earliest occurrence of any term. */
export function makeSnippet(
  content: string,
  terms: string[],
  radius = 50,
): { text: string; matchStart: number; matchEnd: number } | null {
  const lower = content.toLowerCase()
  let best = -1
  let len = 0
  for (const t of terms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(t)}`, 'u')
    const m = re.exec(lower)
    if (!m) continue
    const at = m.index + m[1]!.length
    if (best === -1 || at < best) {
      best = at
      len = t.length
    }
  }
  if (best === -1) return null
  const start = Math.max(0, best - radius)
  const end = Math.min(content.length, best + len + radius * 1.5)
  const prefix = start > 0 ? '…' : ''
  const raw = content.slice(start, end).replace(/\s+/g, ' ')
  // Recompute match position after whitespace collapsing.
  const before = content.slice(start, best).replace(/\s+/g, ' ')
  const matchStart = prefix.length + before.length
  return {
    text: prefix + raw + (end < content.length ? '…' : ''),
    matchStart,
    matchEnd: matchStart + len,
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Split text into parts, marking case-insensitive occurrences of any term (word-prefix matches). */
export function highlightParts(text: string, terms: string[]): { text: string; match: boolean }[] {
  const ts = terms.filter(Boolean).sort((a, b) => b.length - a.length)
  if (!ts.length) return [{ text, match: false }]
  const re = new RegExp(`(${ts.map(escapeRegExp).join('|')})`, 'giu')
  const parts: { text: string; match: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), match: false })
    parts.push({ text: m[0], match: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false })
  return parts
}
