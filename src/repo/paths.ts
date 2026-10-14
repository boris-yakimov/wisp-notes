/** Pure helpers for repo paths. Paths are POSIX-style, relative to repo root, no leading slash. */

export const META_FILE = '_meta.json'

/**
 * Stands for "/" inside a name. Drive allows "/" in file names, but paths use it as the separator, so a
 * path segment is the Drive name with "/" replaced by this private-use character. Convert at the edges:
 * `encodeName` for names from Drive or the user, `decodeName`/`fileName`/`noteTitle` for Drive and display.
 */
export const NAME_SLASH = '\uE000'

/** Drive or typed name → path segment. */
export function encodeName(name: string): string {
  return name.replaceAll('/', NAME_SLASH)
}

/** Path segment → real name (as in Drive and shown to the user). */
export function decodeName(segment: string): string {
  return segment.replaceAll(NAME_SLASH, '/')
}
export const NOTE_EXT = '.md'

export function isNotePath(path: string): boolean {
  return path.toLowerCase().endsWith(NOTE_EXT)
}

export function isMetaPath(path: string): boolean {
  return basename(path) === META_FILE
}

/** Parent folder ('' for root). */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** Real file name of the last segment: "Work/CI\uE000CD.md" → "CI/CD.md". Use for Drive and `_meta.json`. */
export function fileName(path: string): string {
  return decodeName(basename(path))
}

/** Path for display: "Work/CI\uE000CD" → "Work / CI/CD". */
export function displayPath(path: string, sep = ' / '): string {
  return path.split('/').map(decodeName).join(sep)
}

/** "Work/Plan.md" → "Plan" (with real slashes: "CI/CD.md" → "CI/CD") */
export function noteTitle(path: string): string {
  const b = fileName(path)
  return isNotePath(b) ? b.slice(0, -NOTE_EXT.length) : b
}

export function metaPath(folder: string): string {
  return joinPath(folder, META_FILE)
}

/**
 * Folder holding a note's sub-notes: "Work/Plan.md" → "Work/Plan" (same layout as a Notion export).
 * The folder may not exist yet; it is created with the first sub-note.
 */
export function childFolderOf(notePath: string): string {
  return isNotePath(notePath) ? notePath.slice(0, -NOTE_EXT.length) : notePath
}

/** True if `path` equals `folder` or lies inside it. */
export function isInside(path: string, folder: string): boolean {
  return folder === '' || path === folder || path.startsWith(folder + '/')
}

/** Hidden paths (any segment starting with '.') are ignored, e.g. `.github/`. */
export function isHidden(path: string): boolean {
  return path.split('/').some((s) => s.startsWith('.'))
}

/** Returns an error message for an invalid note/folder name, or null if valid. */
export function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Name cannot be empty.'
  if (n.includes('\\')) return 'Name cannot contain backslashes.'
  if (n.includes(NAME_SLASH)) return 'Name contains an unsupported character.'
  if (n.startsWith('.')) return 'Name cannot start with a dot.'
  if (n === META_FILE) return 'This name is reserved.'
  if (n.length > 200) return 'Name is too long.'
  return null
}

/** Encode a repo path for use in the URL (/n/<path>), keeping slashes readable. */
export function notePathToUrl(path: string): string {
  return (
    '/n/' +
    path
      .split('/')
      .map((s) => encodeURIComponent(decodeName(s)))
      .join('/')
  )
}

/** Inverse of `notePathToUrl`, from the raw (still encoded) URL pathname; null if not a note URL. */
export function urlToNotePath(pathname: string): string | null {
  if (!pathname.startsWith('/n/')) return null
  return pathname
    .slice(3)
    .split('/')
    .map((s) => {
      try {
        return encodeName(decodeURIComponent(s))
      } catch {
        return s
      }
    })
    .join('/')
}

/** `Work/Plan.md` → `Work/Plan (conflict 2026-10-11).md`, unique against `existing`. */
export function conflictPath(path: string, date: Date, existing: (p: string) => boolean): string {
  const dir = dirname(path)
  const title = noteTitle(path)
  const ext = isNotePath(path) ? NOTE_EXT : ''
  const day = date.toISOString().slice(0, 10)
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : ` ${n}`
    const candidate = joinPath(dir, `${title} (conflict ${day}${suffix})${ext}`)
    if (!existing(candidate)) return candidate
  }
}
