import type { Entry } from '../drive/remoteTree.ts'
import type { DriveOp } from './apply.ts'
import {
  basename,
  childFolderOf,
  decodeName,
  encodeName,
  fileName,
  dirname,
  isInside,
  isNotePath,
  joinPath,
  metaPath,
  NOTE_EXT,
  noteTitle,
  validateName,
} from './paths.ts'
import { buildTree, findContainer, itemName, serializeMeta, withNoteIcon, type FolderMeta } from './tree.ts'

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
  return encodeName(name.trim())
}

/** Adds ".md" unless the user typed it. */
function noteFileName(name: string): string {
  const n = checkName(name)
  return n.toLowerCase().endsWith(NOTE_EXT) ? n : n + NOTE_EXT
}

const find = (entries: Entry[], path: string) => entries.find((e) => e.path === path)
const taken = (entries: Entry[], path: string) =>
  entries.some((e) => e.path.toLowerCase() === path.toLowerCase())
const isFolder = (entries: Entry[], path: string) => !!find(entries, path)?.folder
const isNote = (entries: Entry[], path: string) => {
  const e = find(entries, path)
  return !!e && !e.folder && isNotePath(path)
}
/** The note's sub-note folder, if it exists. */
const childFolder = (entries: Entry[], notePath: string) => {
  const c = childFolderOf(notePath)
  return isFolder(entries, c) ? c : undefined
}
/** Can items be put into `folder`: top level, a folder, or a note (its sub-note folder)? */
const isContainer = (entries: Entry[], folder: string) =>
  folder === '' ||
  isFolder(entries, folder) ||
  entries.some((e) => !e.folder && isNotePath(e.path) && childFolderOf(e.path) === folder)
/** A note "X.md" and a folder "X" side by side form one item (note with sub-notes). */
const pairOf = (path: string, folder: boolean) => (folder ? path + NOTE_EXT : childFolderOf(path))
/** Old → new paths for an item and everything inside it. */
function movedPaths(entries: Entry[], pairs: [string, string][]): Record<string, string> {
  const moved: Record<string, string> = {}
  for (const [from, to] of pairs)
    for (const e of entries) if (isInside(e.path, from)) moved[e.path] = to + e.path.slice(from.length)
  return moved
}

type Metas = Record<string, FolderMeta>

const writeMeta = (folder: string, meta: FolderMeta): DriveOp =>
  // No conflict check (base undefined): icons are tiny settings, last write wins.
  ({ kind: 'write', path: metaPath(folder), content: serializeMeta(meta) })

/** Pending `_meta.json` changes, so each folder's meta is written once, with all changes combined. */
class MetaEdits {
  private metas: Metas
  private next = new Map<string, FolderMeta>()
  constructor(metas: Metas) {
    this.metas = metas
  }
  get(folder: string): FolderMeta {
    return this.next.get(folder) ?? this.metas[folder] ?? {}
  }
  set(folder: string, meta: FolderMeta): void {
    this.next.set(folder, meta)
  }
  ops(): DriveOp[] {
    return [...this.next].map(([f, m]) => writeMeta(f, m))
  }
}

/** Carry a note's icon from `from` to `to` (or drop it if `to` is null). */
function moveNoteIcon(edits: MetaEdits, from: string, to: string | null): void {
  const icon = edits.get(dirname(from)).notes?.[fileName(from)]
  if (!icon) return
  edits.set(dirname(from), withNoteIcon(edits.get(dirname(from)), fileName(from), undefined))
  if (to !== null) edits.set(dirname(to), withNoteIcon(edits.get(dirname(to)), fileName(to), icon))
}

/**
 * Keep the custom order in sync: a rename keeps the item's position; a move or delete removes it from
 * its old folder's order (in the new folder it goes to the end until reordered).
 */
function moveInOrder(edits: MetaEdits, from: string, to: string | null): void {
  const meta = edits.get(dirname(from))
  const order = meta.order
  if (!order?.includes(fileName(from))) return
  const same = to !== null && dirname(to) === dirname(from)
  const next = same
    ? order.map((n) => (n === fileName(from) ? fileName(to) : n))
    : order.filter((n) => n !== fileName(from))
  const updated: FolderMeta = { ...meta, order: next }
  if (!next.length) delete updated.order
  edits.set(dirname(from), updated)
}

/** Create a note in `folder`. For a sub-note, `folder` is the parent note's `childFolderOf`. */
export function createNoteOp(folder: string, name: string, entries: Entry[]): Op {
  const path = joinPath(folder, noteFileName(name))
  if (taken(entries, path)) throw new OpError(`A note named "${fileName(path)}" already exists here.`)
  if (taken(entries, childFolderOf(path)))
    throw new OpError(`A folder named "${noteTitle(path)}" already exists here.`)
  return { ops: [{ kind: 'write', path, content: '', base: null }], target: path }
}

export function createFolderOp(parent: string, name: string, entries: Entry[]): Op {
  const path = joinPath(parent, checkName(name))
  if (taken(entries, path)) throw new OpError(`A folder named "${fileName(path)}" already exists here.`)
  if (taken(entries, path + NOTE_EXT))
    throw new OpError(`A note named "${fileName(path)}" already exists here.`)
  return { ops: [{ kind: 'mkdir', path }], target: path }
}

/** Rename a note; its sub-notes folder is renamed with it. */
export function renameNoteOp(path: string, newName: string, entries: Entry[], metas: Metas = {}): Op {
  if (!find(entries, path)) throw new OpError('The note no longer exists.')
  const to = joinPath(dirname(path), noteFileName(newName))
  if (to === path) return { ops: [], target: path }
  // Case-only renames are fine; anything else must be free.
  if (to.toLowerCase() !== path.toLowerCase()) {
    if (taken(entries, to)) throw new OpError(`A note named "${fileName(to)}" already exists here.`)
    if (taken(entries, childFolderOf(to)))
      throw new OpError(`A folder named "${noteTitle(to)}" already exists here.`)
  }
  const child = childFolder(entries, path)
  const ops: DriveOp[] = [{ kind: 'rename', path, to }]
  if (child) ops.push({ kind: 'rename', path: child, to: childFolderOf(to) })
  const edits = new MetaEdits(metas)
  moveNoteIcon(edits, path, to)
  moveInOrder(edits, path, to)
  ops.push(...edits.ops())
  return {
    ops,
    target: to,
    moved: movedPaths(
      entries,
      child
        ? [
            [path, to],
            [child, childFolderOf(to)],
          ]
        : [[path, to]],
    ),
  }
}

/** Delete a note together with its sub-notes. */
export function deleteNoteOp(path: string, entries: Entry[], metas: Metas = {}): Op {
  if (!find(entries, path)) throw new OpError('The note no longer exists.')
  const child = childFolder(entries, path)
  const edits = new MetaEdits(metas)
  moveNoteIcon(edits, path, null) // so a new note with the same name doesn't inherit it
  moveInOrder(edits, path, null)
  return {
    ops: [
      { kind: 'trash', path },
      ...(child ? [{ kind: 'trash' as const, path: child }] : []),
      ...edits.ops(),
    ],
  }
}

/** One Drive rename; everything inside moves with the folder. */
export function renameFolderOp(folder: string, newName: string, entries: Entry[], metas: Metas = {}): Op {
  if (!isFolder(entries, folder)) throw new OpError('The folder no longer exists.')
  const to = joinPath(dirname(folder), checkName(newName))
  if (to === folder) return { ops: [], target: folder }
  if (to.toLowerCase() !== folder.toLowerCase()) {
    if (taken(entries, to)) throw new OpError(`A folder named "${fileName(to)}" already exists here.`)
    if (taken(entries, to + NOTE_EXT))
      throw new OpError(`A note named "${fileName(to)}" already exists here.`)
  }
  const moved = movedPaths(entries, [[folder, to]])
  delete moved[folder]
  const edits = new MetaEdits(metas)
  moveInOrder(edits, folder, to)
  return { ops: [{ kind: 'rename', path: folder, to }, ...edits.ops()], target: to, moved }
}

/**
 * Move a note or folder into another folder ('' = top level) or under a note (`childFolderOf(note)`),
 * keeping its name. A note's sub-notes move with it. One Drive request per moved item.
 */
export function moveOp(path: string, toFolder: string, entries: Entry[], metas: Metas = {}): Op {
  const edits = new MetaEdits(metas)
  const op = moveWith(edits, path, toFolder, entries)
  return { ...op, ops: [...op.ops, ...edits.ops()] }
}

function moveWith(edits: MetaEdits, path: string, toFolder: string, entries: Entry[]): Op {
  const src = find(entries, path)
  if (!src) throw new OpError(`"${fileName(path)}" no longer exists.`)
  if (!isContainer(entries, toFolder)) throw new OpError('The target no longer exists.')
  if (dirname(path) === toFolder) return { ops: [], target: path }
  const own = src.folder ? path : childFolderOf(path) // where its contents live
  if (toFolder !== '' && isInside(toFolder, own))
    throw new OpError(`“${noteTitle(path)}” cannot be moved into itself.`)
  const to = joinPath(toFolder, fileName(path))
  if (taken(entries, to) || taken(entries, pairOf(to, src.folder))) {
    const where = toFolder ? `“${fileName(toFolder)}”` : 'the top level'
    throw new OpError(`An item named "${noteTitle(path)}" already exists in ${where}.`)
  }
  const child = src.folder ? undefined : childFolder(entries, path)
  const pairs: [string, string][] = [[path, to]]
  if (child) pairs.push([child, childFolderOf(to)])
  if (!src.folder) moveNoteIcon(edits, path, to)
  moveInOrder(edits, path, to)
  return {
    ops: pairs.map(([p, t]) => ({ kind: 'rename' as const, path: p, to: t })),
    target: to,
    moved: movedPaths(entries, pairs),
  }
}

/** Sidebar items of a container, in display order. */
function containerItems(container: string, entries: Entry[], metas: Metas) {
  const root = buildTree(
    entries.filter((e) => !e.folder).map((e) => e.path),
    metas,
    entries.filter((e) => e.folder).map((e) => e.path),
  )
  return findContainer(root, container)?.items ?? []
}

/**
 * Put a note or folder right before or after `target` in the sidebar, moving it into `target`'s
 * container first if needed. The container's full order is saved in its `_meta.json`.
 */
export function placeOp(
  path: string,
  target: string,
  where: 'before' | 'after',
  entries: Entry[],
  metas: Metas = {},
): Op {
  if (path === target) return { ops: [] }
  if (!find(entries, target)) throw new OpError(`"${fileName(target)}" no longer exists.`)
  const container = dirname(target)
  const edits = new MetaEdits(metas)
  const move =
    dirname(path) === container ? { ops: [], target: path } : moveWith(edits, path, container, entries)
  const moved = move.target ?? path
  const names = containerItems(container, entries, metas)
    .map(itemName)
    .filter((n) => n !== fileName(path))
  const at = names.indexOf(fileName(target))
  if (at < 0) throw new OpError(`"${fileName(target)}" no longer exists.`)
  names.splice(where === 'before' ? at : at + 1, 0, fileName(moved))
  const current = containerItems(container, entries, metas).map(itemName)
  if (!move.ops.length && names.join('\n') === current.join('\n') && edits.get(container).order)
    return { ops: [] }
  edits.set(container, { ...edits.get(container), order: names })
  return { ...move, ops: [...move.ops, ...edits.ops()] }
}

/** Move a note or folder one place up (-1) or down (+1) among its siblings. */
export function shiftOp(path: string, delta: -1 | 1, entries: Entry[], metas: Metas = {}): Op {
  const items = containerItems(dirname(path), entries, metas)
  const i = items.findIndex((n) => n.path === path)
  const neighbor = items[i + delta]
  if (i < 0 || !neighbor) return { ops: [] }
  return placeOp(path, neighbor.path, delta < 0 ? 'before' : 'after', entries, metas)
}

/** Can `path` move up (-1) or down (+1)? */
export function canShift(path: string, delta: -1 | 1, entries: Entry[], metas: Metas = {}): boolean {
  const items = containerItems(dirname(path), entries, metas)
  const i = items.findIndex((n) => n.path === path)
  return i >= 0 && !!items[i + delta]
}

/**
 * Where a note/folder can be moved: top level (''), every folder, and under every note
 * (as `childFolderOf(note)`), except its current parent and itself/its descendants.
 */
export function moveTargets(path: string, entries: Entry[]): string[] {
  const src = find(entries, path)
  const parent = dirname(path)
  const own = src?.folder ? path : childFolderOf(path)
  const candidates = new Set([
    '',
    ...entries.filter((e) => e.folder).map((e) => e.path),
    ...entries.filter((e) => isNote(entries, e.path)).map((e) => childFolderOf(e.path)),
  ])
  return [...candidates]
    .filter((f) => f !== parent && !(f !== '' && isInside(f, own)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

export function deleteFolderOp(folder: string, entries: Entry[], metas: Metas = {}): Op {
  if (!isFolder(entries, folder)) throw new OpError('The folder no longer exists.')
  const edits = new MetaEdits(metas)
  moveInOrder(edits, folder, null)
  return { ops: [{ kind: 'trash', path: folder }, ...edits.ops()] }
}

export function setFolderIconOp(folder: string, icon: string | undefined, current: FolderMeta): Op {
  const meta: FolderMeta = { ...current }
  if (icon) meta.icon = icon
  else delete meta.icon
  return { ops: [writeMeta(folder, meta)] }
}

/** A note's icon lives in its folder's `_meta.json` under `notes`. */
export function setNoteIconOp(note: string, icon: string | undefined, metas: Metas): Op {
  const folder = dirname(note)
  return { ops: [writeMeta(folder, withNoteIcon(metas[folder] ?? {}, fileName(note), icon))] }
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

export interface IconSuggestion {
  path: string
  /** Folder (icon in its own `_meta.json`) or note (icon in its folder's `_meta.json`). */
  folder: boolean
  icon: string
}

/**
 * Icons for every note and subfolder inside `folder` (recursively) that has no icon yet,
 * guessed from its name. Folders holding a note's sub-notes are skipped: the note carries the icon.
 */
export function suggestIcons(
  folder: string,
  entries: Entry[],
  metas: Metas,
  suggest: (title: string) => string | undefined,
): IconSuggestion[] {
  const notes = new Set(entries.filter((e) => !e.folder && isNotePath(e.path)).map((e) => e.path))
  const out: IconSuggestion[] = []
  for (const e of entries) {
    if (e.path === folder || !isInside(e.path, folder) || basename(e.path).startsWith('.')) continue
    if (e.folder) {
      if (notes.has(e.path + NOTE_EXT) || metas[e.path]?.icon) continue
    } else if (!isNotePath(e.path) || metas[dirname(e.path)]?.notes?.[fileName(e.path)]) continue
    const icon = suggest(noteTitle(e.path))
    if (icon) out.push({ path: e.path, folder: e.folder, icon })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
}

/** One `_meta.json` write per affected folder. */
export function setIconsOp(suggestions: IconSuggestion[], metas: Metas): Op {
  const next = new Map<string, FolderMeta>()
  const get = (f: string) => next.get(f) ?? { ...metas[f] }
  for (const s of suggestions) {
    if (s.folder) next.set(s.path, { ...get(s.path), icon: s.icon })
    else next.set(dirname(s.path), withNoteIcon(get(dirname(s.path)), fileName(s.path), s.icon))
  }
  return { ops: [...next].map(([f, meta]) => writeMeta(f, meta)) }
}

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** Largest pasted image accepted (Drive multipart uploads are meant for small files). */
export const MAX_PASTED_IMAGE = 20 * 1024 * 1024

/** File extension for a pasted image's MIME type, or null if it isn't a supported image. */
export function pastedImageExt(mimeType: string): string | null {
  return IMAGE_TYPES[mimeType.toLowerCase()] ?? null
}

/**
 * Where a pasted image is stored: next to its note's sub-notes, `Plan.md` → `Plan/Pasted image
 * 2026-10-14 134912.png` (the Notion export layout), plus the Markdown that shows it in the note.
 */
export function pastedImage(
  notePath: string,
  ext: string,
  now: Date,
  entries: Entry[],
): { path: string; markdown: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const folder = childFolderOf(notePath)
  let name = `Pasted image ${stamp}.${ext}`
  for (let n = 2; taken(entries, joinPath(folder, name)); n++) name = `Pasted image ${stamp} (${n}).${ext}`
  const path = joinPath(folder, name)
  const rel = [basename(folder), name].map((s) => encodeURIComponent(decodeName(s))).join('/')
  return { path, markdown: `![](${rel})` }
}
