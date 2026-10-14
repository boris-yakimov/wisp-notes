import { dirname, encodeName, isNotePath } from './paths.ts'

/**
 * Where a clicked link leads: another note in the repo, another file in the repo (image, PDF, …),
 * or an external URL opened in a new tab.
 */
export type LinkTarget =
  { kind: 'note'; path: string } | { kind: 'file'; path: string } | { kind: 'external'; url: string }

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path)
}

const SAFE_SCHEME = /^(https?|mailto):/i
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

/**
 * Resolve a link written in the note at `fromPath`. Relative links (Notion exports use
 * `Sub%20page.md`) become repo paths: notes, or other files; http(s)/mailto stay external. Anything
 * else (javascript:, data:, paths escaping the repo) returns null and is not opened.
 */
export function resolveLink(href: string, fromPath: string): LinkTarget | null {
  const h = href.trim()
  if (!h) return null
  if (SAFE_SCHEME.test(h)) return { kind: 'external', url: h }
  if (ANY_SCHEME.test(h)) return null
  if (/^www\./i.test(h)) return { kind: 'external', url: `https://${h}` }
  if (EMAIL.test(h)) return { kind: 'external', url: `mailto:${h}` }
  const path = resolveRepoPath(h, fromPath)
  if (!path) return null
  return { kind: isNotePath(path) ? 'note' : 'file', path }
}

/** Repo path of a relative (or root-relative) link from the note at `fromPath`; null if not a repo path. */
export function resolveRepoPath(href: string, fromPath: string): string | null {
  const h = href.trim()
  if (!h || ANY_SCHEME.test(h) || h.startsWith('//')) return null
  const target = h.replace(/[?#].*$/, '')
  // Decode per segment: an encoded "%2F" is a slash inside a name, not a separator.
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  const segs = target.split('/').map(decode)
  if (!segs[segs.length - 1]) return null
  const parts = target.startsWith('/') ? [] : dirname(fromPath).split('/').filter(Boolean)
  for (const raw of segs) {
    const seg = raw === '.' || raw === '..' ? raw : encodeName(raw)
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.length ? parts.join('/') : null
}
