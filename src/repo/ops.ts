import type { Entry } from '../drive/remoteTree.ts'
import type { DriveOp } from './apply.ts'
import { basename, dirname, isInside, joinPath, metaPath, NOTE_EXT, validateName } from './paths.ts'
import { serializeMeta, type FolderMeta } from './tree.ts'

/**
 * Pure builders for note/folder operations. They validate input and return Drive ops;
 * they throw OpError with a user-facing message for invalid input.
 */

export class OpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpError'
  }
}

export interface Op {
  ops: DriveOp[]
  /** Where the affected item lives afterwards (for navigation), if anywhere. */
  target?: string
  /** Old → new path for moved notes (to follow the open note). */
  moved?: Record<string, string>
}

function checkName(name: string): string {
  const err = validateName(name)
  if (err) throw new OpError(err)
  return name.trim()
}

/** Adds ".md" unless the user typed it. */
function noteFileName(name: string): string {
  const n = checkName(name)
  return n.toLowerCase().endsWith(NOTE_EXT) ? n : n + NOTE_EXT
}

const find = (entries: Entry[], path: string) => entries.find((e) => e.path === path)
const taken = (entries: Entry[], path: string) =>
  entries.some((e) => e.path.toLowerCase() === path.toLowerCase())

export function createNoteOp(folder: string, name: string, entries: Entry[]): Op {
  const path = joinPath(folder, noteFileName(name))
  if (taken(entries, path)) throw new OpError(`A note named "${basename(path)}" already exists here.`)
  return { ops: [{ kind: 'write', path, content: '', base: null }], target: path }
}

export function createFolderOp(parent: string, name: string, entries: Entry[]): Op {
  const path = joinPath(parent, checkName(name))
  if (taken(entries, path)) throw new OpError(`A folder named "${basename(path)}" already exists here.`)
  return { ops: [{ kind: 'mkdir', path }], target: path }
}

export function renameNoteOp(path: string, newName: string, entries: Entry[]): Op {
  if (!find(entries, path)) throw new OpError('The note no longer exists.')
  const to = joinPath(dirname(path), noteFileName(newName))
  if (to === path) return { ops: [], target: path }
  // Case-only renames are fine; anything else must be free.
  if (to.toLowerCase() !== path.toLowerCase() && taken(entries, to)) {
    throw new OpError(`A note named "${basename(to)}" already exists here.`)
  }
  return { ops: [{ kind: 'rename', path, to }], target: to, moved: { [path]: to } }
}

export function deleteNoteOp(path: string, entries: Entry[]): Op {
  if (!find(entries, path)) throw new OpError('The note no longer exists.')
  return { ops: [{ kind: 'trash', path }] }
}

/** One Drive rename; everything inside moves with the folder. */
export function renameFolderOp(folder: string, newName: string, entries: Entry[]): Op {
  if (!find(entries, folder)?.folder) throw new OpError('The folder no longer exists.')
  const to = joinPath(dirname(folder), checkName(newName))
  if (to === folder) return { ops: [], target: folder }
  if (to.toLowerCase() !== folder.toLowerCase() && taken(entries, to)) {
    throw new OpError(`A folder named "${basename(to)}" already exists here.`)
  }
  const moved: Record<string, string> = {}
  for (const e of entries) {
    if (e.path !== folder && isInside(e.path, folder)) moved[e.path] = to + e.path.slice(folder.length)
  }
  return { ops: [{ kind: 'rename', path: folder, to }], target: to, moved }
}

export function deleteFolderOp(folder: string, entries: Entry[]): Op {
  if (!find(entries, folder)?.folder) throw new OpError('The folder no longer exists.')
  return { ops: [{ kind: 'trash', path: folder }] }
}

export function setFolderIconOp(folder: string, icon: string | undefined, current: FolderMeta): Op {
  const meta: FolderMeta = { ...current }
  if (icon) meta.icon = icon
  else delete meta.icon
  // No conflict check (base undefined): the icon is a tiny setting, last write wins.
  return { ops: [{ kind: 'write', path: metaPath(folder), content: serializeMeta(meta) }] }
}

/** Number of notes affected by deleting a folder (for the confirmation message). */
export function countNotes(folder: string, entries: Entry[]): number {
  return entries.filter(
    (e) => !e.folder && isInside(e.path, folder) && e.path.toLowerCase().endsWith(NOTE_EXT),
  ).length
}

export interface ImportFile {
  /** Path relative to the import target, e.g. "Export/Work/Plan.md". */
  relativePath: string
  content: string | Blob
}

/**
 * Upload local files into `folder`, keeping their relative structure. Hidden files are skipped;
 * name clashes with existing items get a numeric suffix ("Plan (2).md").
 */
export function importOp(folder: string, files: ImportFile[], entries: Entry[]): Op {
  const used = new Set(entries.map((e) => e.path.toLowerCase()))
  const ops: DriveOp[] = []
  const renamedDirs = new Map<string, string>() // top-level imported dir → unique name
  for (const f of files) {
    const parts = f.relativePath.split('/').filter(Boolean)
    if (!parts.length || parts.some((p) => p.startsWith('.') || p.length > 200)) continue
    // A top-level folder that already exists gets a unique name once, for all its files.
    if (parts.length > 1) {
      const top = parts[0]!
      let unique = renamedDirs.get(top)
      if (!unique) {
        unique = top
        for (let n = 2; used.has(joinPath(folder, unique).toLowerCase()); n++) unique = `${top} (${n})`
        renamedDirs.set(top, unique)
        used.add(joinPath(folder, unique).toLowerCase())
      }
      parts[0] = unique
    }
    let path = joinPath(folder, parts.join('/'))
    const base = path
    for (let n = 2; used.has(path.toLowerCase()); n++) {
      const dot = base.lastIndexOf('.')
      path =
        dot > base.lastIndexOf('/') + 1 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`
    }
    used.add(path.toLowerCase())
    ops.push({ kind: 'write', path, content: f.content, base: null })
  }
  return { ops, target: folder }
}
