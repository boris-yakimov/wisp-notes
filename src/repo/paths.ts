/** Pure helpers for repo paths. Paths are POSIX-style, relative to repo root, no leading slash. */

export const META_FILE = '_meta.json'
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

/** "Work/Plan.md" → "Plan" */
export function noteTitle(path: string): string {
  const b = basename(path)
  return isNotePath(b) ? b.slice(0, -NOTE_EXT.length) : b
}

export function metaPath(folder: string): string {
  return joinPath(folder, META_FILE)
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
  if (n.includes('/') || n.includes('\\')) return 'Name cannot contain slashes.'
  if (n.startsWith('.')) return 'Name cannot start with a dot.'
  if (n === META_FILE) return 'This name is reserved.'
  if (n.length > 200) return 'Name is too long.'
  return null
}

/** Encode a repo path for use in the URL (/n/<path>), keeping slashes readable. */
export function notePathToUrl(path: string): string {
  return '/n/' + path.split('/').map(encodeURIComponent).join('/')
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
