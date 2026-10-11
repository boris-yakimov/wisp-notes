import type { TreeEntry } from '../github/client.ts'
import type { Change } from './commit.ts'
import { basename, dirname, isInside, joinPath, metaPath, NOTE_EXT, validateName } from './paths.ts'
import { serializeMeta, type FolderMeta } from './tree.ts'

/**
 * Pure change-set builders for note/folder operations. Each operation becomes one commit.
 * They throw OpError with a user-facing message for invalid input.
 */

export class OpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpError'
  }
}

export interface Op {
  changes: Change[]
  message: string
  /** Where the affected item lives afterwards (for navigation), if anywhere. */
  target?: string
  /** Old → new path mapping for moved notes (to follow the open note). */
  moved?: Record<string, string>
}

type Exists = (path: string) => boolean

function checkName(name: string): string {
  const err = validateName(name)
  if (err) throw new OpError(err)
  return name.trim()
}

/** Strip a trailing ".md" the user may have typed. */
function noteFileName(name: string): string {
  const n = checkName(name)
  return n.toLowerCase().endsWith(NOTE_EXT) ? n : n + NOTE_EXT
}

function folderHasContent(entries: TreeEntry[], folder: string): boolean {
  return entries.some((e) => isInside(e.path, folder) && e.path !== folder)
}

export function createNoteOp(folder: string, name: string, exists: Exists): Op {
  const path = joinPath(folder, noteFileName(name))
  if (exists(path)) throw new OpError(`A note named "${basename(path)}" already exists here.`)
  return { changes: [{ path, content: '' }], message: `Create ${path}`, target: path }
}

export function createFolderOp(parent: string, name: string, entries: TreeEntry[]): Op {
  const folder = joinPath(parent, checkName(name))
  if (entries.some((e) => e.path === folder) || folderHasContent(entries, folder)) {
    throw new OpError(`A folder named "${basename(folder)}" already exists here.`)
  }
  // Git cannot track empty folders: _meta.json doubles as a placeholder.
  return {
    changes: [{ path: metaPath(folder), content: serializeMeta({}) }],
    message: `Create folder ${folder}`,
    target: folder,
  }
}

export function renameNoteOp(path: string, newName: string, entries: TreeEntry[]): Op {
  const sha = entries.find((e) => e.path === path)?.sha
  if (!sha) throw new OpError('The note no longer exists.')
  const to = joinPath(dirname(path), noteFileName(newName))
  if (to === path) return { changes: [], message: '', target: path }
  // Case-only renames are allowed (the old entry is removed in the same commit).
  if (entries.some((e) => e.path === to))
    throw new OpError(`A note named "${basename(to)}" already exists here.`)
  return {
    changes: [
      { path, content: null, baseSha: sha },
      { path: to, content: { sha }, baseSha: null },
    ],
    message: `Rename ${path} → ${to}`,
    target: to,
    moved: { [path]: to },
  }
}

export function deleteNoteOp(path: string, entries: TreeEntry[]): Op {
  const sha = entries.find((e) => e.path === path)?.sha
  if (!sha) throw new OpError('The note no longer exists.')
  return { changes: [{ path, content: null, baseSha: sha }], message: `Delete ${path}` }
}

/** Moves every file inside the folder (including non-notes) in one commit. */
export function renameFolderOp(folder: string, newName: string, entries: TreeEntry[]): Op {
  const to = joinPath(dirname(folder), checkName(newName))
  if (to === folder) return { changes: [], message: '', target: folder }
  if (folderHasContent(entries, to) && to.toLowerCase() !== folder.toLowerCase()) {
    throw new OpError(`A folder named "${basename(to)}" already exists here.`)
  }
  const inside = entries.filter((e) => isInside(e.path, folder) && e.path !== folder)
  if (!inside.length) throw new OpError('The folder no longer exists.')
  const changes: Change[] = []
  const moved: Record<string, string> = {}
  for (const e of inside) {
    const dest = to + e.path.slice(folder.length)
    moved[e.path] = dest
    changes.push(
      { path: e.path, content: null, baseSha: e.sha },
      { path: dest, content: { sha: e.sha }, baseSha: null },
    )
  }
  return { changes, message: `Rename folder ${folder} → ${to}`, target: to, moved }
}

export function deleteFolderOp(folder: string, entries: TreeEntry[]): Op {
  const inside = entries.filter((e) => isInside(e.path, folder) && e.path !== folder)
  if (!inside.length) throw new OpError('The folder no longer exists.')
  return {
    changes: inside.map((e) => ({ path: e.path, content: null, baseSha: e.sha })),
    message: `Delete folder ${folder} (${inside.length} files)`,
  }
}

export function setFolderIconOp(folder: string, icon: string | undefined, current: FolderMeta): Op {
  const meta: FolderMeta = { ...current }
  if (icon) meta.icon = icon
  else delete meta.icon
  const path = metaPath(folder)
  return {
    changes: [{ path, content: serializeMeta(meta) }],
    message: icon ? `Set icon of ${folder || 'root'} to ${icon}` : `Remove icon of ${folder || 'root'}`,
  }
}

/** Number of notes affected by deleting a folder (for the confirmation message). */
export function countNotes(folder: string, entries: TreeEntry[]): number {
  return entries.filter((e) => isInside(e.path, folder) && e.path.toLowerCase().endsWith(NOTE_EXT)).length
}
