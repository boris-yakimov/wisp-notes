import { basename, dirname, isHidden, isMetaPath, isNotePath, noteTitle } from './paths.ts'

export interface FolderMeta {
  icon?: string
}

export interface NoteNode {
  kind: 'note'
  path: string
  name: string
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
 * - A folder is shown if it (transitively) contains a note or has a `_meta.json`.
 * - Hidden paths (segments starting with '.') are ignored.
 * - Folders first, then notes; each alphabetical (case-insensitive, numeric-aware).
 */
export function buildTree(paths: Iterable<string>, metas: Record<string, FolderMeta> = {}): FolderNode {
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
  return root
}

/** All folder paths present in the tree (excluding root). */
export function folderPaths(paths: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const p of paths) {
    for (let d = dirname(p); d; d = dirname(d)) out.add(d)
  }
  return out
}
