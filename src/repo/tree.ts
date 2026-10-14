import { childFolderOf, dirname, fileName, isHidden, isMetaPath, isNotePath, noteTitle } from './paths.ts'

export interface FolderMeta {
  icon?: string
  /** Icons of the notes in this folder, by file name ("Plan.md" → "star"). */
  notes?: Record<string, string>
  /** Custom sidebar order of this folder's items, by file/folder name. Unlisted items follow, sorted. */
  order?: string[]
}

export interface NoteNode {
  kind: 'note'
  path: string
  name: string
  icon: string | undefined
  /** Sub-notes: the folder next to the note with the same name ("Plan.md" + "Plan/"). */
  children?: FolderNode
}

export interface FolderNode {
  kind: 'folder'
  path: string // '' for root
  name: string
  icon: string | undefined
  folders: FolderNode[]
  notes: NoteNode[]
  /** Folders and notes in display order (custom `order` from `_meta.json`, then folders, then notes). */
  items: (FolderNode | NoteNode)[]
}

/** Parse `_meta.json`; invalid JSON or shape yields an empty meta. */
export function parseMeta(text: string | undefined): FolderMeta {
  if (!text) return {}
  try {
    const v = JSON.parse(text) as unknown
    if (!v || typeof v !== 'object') return {}
    const raw = v as { icon?: unknown; notes?: unknown; order?: unknown }
    const meta: FolderMeta = {}
    if (typeof raw.icon === 'string') meta.icon = raw.icon
    if (raw.notes && typeof raw.notes === 'object') {
      const notes = Object.fromEntries(
        Object.entries(raw.notes).filter((kv): kv is [string, string] => typeof kv[1] === 'string'),
      )
      if (Object.keys(notes).length) meta.notes = notes
    }
    if (Array.isArray(raw.order)) {
      const order = raw.order.filter((x): x is string => typeof x === 'string')
      if (order.length) meta.order = order
    }
    return meta
  } catch {
    return {} // ignore malformed meta
  }
}

/** Copy of `meta` with the icon of note file `name` set (or removed if `icon` is undefined). */
export function withNoteIcon(meta: FolderMeta, name: string, icon: string | undefined): FolderMeta {
  const notes = { ...meta.notes }
  if (icon) notes[name] = icon
  else delete notes[name]
  const next: FolderMeta = { ...meta }
  if (Object.keys(notes).length) next.notes = notes
  else delete next.notes
  return next
}

export function serializeMeta(meta: FolderMeta): string {
  return JSON.stringify(meta, null, 2) + '\n'
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Build the nested folder tree from flat repo file paths.
 * - Only `.md` files become notes; other files are ignored.
 * - Folders listed in `folderPaths` are always shown (Drive has real, possibly empty, folders);
 *   other folders appear if they contain a note or a `_meta.json`.
 * - Hidden paths (segments starting with '.') are ignored.
 * - Folders first, then notes; each alphabetical (case-insensitive, numeric-aware).
 */
export function buildTree(
  paths: Iterable<string>,
  metas: Record<string, FolderMeta> = {},
  folderPaths: Iterable<string> = [],
): FolderNode {
  const root: FolderNode = {
    kind: 'folder',
    path: '',
    name: '',
    icon: metas['']?.icon,
    folders: [],
    notes: [],
    items: [],
  }
  const folders = new Map<string, FolderNode>([['', root]])

  const ensureFolder = (path: string): FolderNode => {
    const existing = folders.get(path)
    if (existing) return existing
    const parent = ensureFolder(dirname(path))
    const node: FolderNode = {
      kind: 'folder',
      path,
      name: fileName(path),
      icon: metas[path]?.icon,
      folders: [],
      notes: [],
      items: [],
    }
    parent.folders.push(node)
    folders.set(path, node)
    return node
  }

  for (const path of folderPaths) {
    if (path && !isHidden(path)) ensureFolder(path)
  }
  for (const path of paths) {
    if (isHidden(path)) continue
    if (isNotePath(path)) {
      ensureFolder(dirname(path)).notes.push({
        kind: 'note',
        path,
        name: noteTitle(path),
        icon: metas[dirname(path)]?.notes?.[fileName(path)],
      })
    } else if (isMetaPath(path)) {
      ensureFolder(dirname(path))
    }
  }

  const sort = (f: FolderNode) => {
    f.folders.sort((a, b) => collator.compare(a.name, b.name))
    f.notes.sort((a, b) => collator.compare(a.name, b.name))
    f.folders.forEach(sort)
  }
  sort(root)
  // A folder next to a note with the same name holds the note's sub-notes.
  const attach = (f: FolderNode) => {
    for (const n of f.notes) {
      const i = f.folders.findIndex((c) => c.path === childFolderOf(n.path))
      if (i >= 0) n.children = f.folders.splice(i, 1)[0]
    }
    f.folders.forEach(attach)
    for (const n of f.notes) if (n.children) attach(n.children)
  }
  attach(root)
  // Display order: names listed in the folder's `order` first, then the rest (folders, then notes).
  const arrange = (f: FolderNode) => {
    const rank = new Map((metas[f.path]?.order ?? []).map((name, i) => [name, i] as const))
    const all = [...f.folders, ...f.notes]
    const listed = all
      .filter((n) => rank.has(itemName(n)))
      .sort((a, b) => rank.get(itemName(a))! - rank.get(itemName(b))!)
    f.items = [...listed, ...all.filter((n) => !rank.has(itemName(n)))]
    f.folders.forEach(arrange)
    for (const n of f.notes) if (n.children) arrange(n.children)
  }
  arrange(root)
  return root
}

/** Name of a tree item as stored in `_meta.json` (`order`, note icons): its real Drive name. */
export function itemName(node: FolderNode | NoteNode): string {
  return fileName(node.path)
}

/**
 * The container holding items at `path` ('' = top level, a folder, or a note's sub-note folder
 * `childFolderOf(note)`). Undefined if it doesn't exist (e.g. a note without sub-notes yet).
 */
export function findContainer(root: FolderNode, path: string): FolderNode | undefined {
  if (path === '') return root
  for (const item of root.items) {
    const inner = item.kind === 'folder' ? item : item.children
    if (!inner) continue
    if (inner.path === path) return inner
    if (path.startsWith(inner.path + '/')) {
      const found = findContainer(inner, path)
      if (found) return found
    }
  }
  return undefined
}

/** The note at `path` in the tree, or undefined. */
export function findNote(root: FolderNode, path: string): NoteNode | undefined {
  for (const n of root.notes) {
    if (n.path === path) return n
    const inner = n.children && findNote(n.children, path)
    if (inner) return inner
  }
  for (const f of root.folders) {
    const inner = findNote(f, path)
    if (inner) return inner
  }
  return undefined
}

/** Does the note have visible sub-notes? */
export function hasChildren(note: NoteNode): boolean {
  return !!note.children && (note.children.folders.length > 0 || note.children.notes.length > 0)
}
