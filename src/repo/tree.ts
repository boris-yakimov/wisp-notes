import { basename, childFolderOf, dirname, isHidden, isMetaPath, isNotePath, noteTitle } from './paths.ts'

export interface FolderMeta {
  icon?: string
}

export interface NoteNode {
  kind: 'note'
  path: string
  name: string
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
}

/** Parse `_meta.json`; invalid JSON or shape yields an empty meta. */
export function parseMeta(text: string | undefined): FolderMeta {
  if (!text) return {}
  try {
    const v: unknown = JSON.parse(text)
    if (v && typeof v === 'object' && typeof (v as FolderMeta).icon === 'string') {
      return { icon: (v as FolderMeta).icon }
    }
  } catch {
    /* ignore malformed meta */
  }
  return {}
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
  }
  const folders = new Map<string, FolderNode>([['', root]])

  const ensureFolder = (path: string): FolderNode => {
    const existing = folders.get(path)
    if (existing) return existing
    const parent = ensureFolder(dirname(path))
    const node: FolderNode = {
      kind: 'folder',
      path,
      name: basename(path),
      icon: metas[path]?.icon,
      folders: [],
      notes: [],
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
      ensureFolder(dirname(path)).notes.push({ kind: 'note', path, name: noteTitle(path) })
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
  return root
}

/** Does the note have visible sub-notes? */
export function hasChildren(note: NoteNode): boolean {
  return !!note.children && (note.children.folders.length > 0 || note.children.notes.length > 0)
}
