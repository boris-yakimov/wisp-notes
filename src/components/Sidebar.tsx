import { ChevronRight, FileText } from 'lucide-react'
import { memo, useMemo } from 'react'
import { NavLink } from 'react-router'
import { notePathToUrl } from '../repo/paths.ts'
import { useRepo } from '../repo/session.ts'
import { buildTree, type FolderNode, type NoteNode } from '../repo/tree.ts'
import { useUi } from '../store/ui.ts'
import { FolderIcon } from './FolderIcon.tsx'

export interface TreeActions {
  /** Open the context menu for a node at screen coordinates. */
  onContextMenu?: (node: FolderNode | NoteNode, x: number, y: number) => void
}

/** Folder tree built from the current snapshot. */
export function Sidebar({ onContextMenu, header }: TreeActions & { header?: React.ReactNode }) {
  const snapshot = useRepo((s) => s.snapshot)
  const metas = useRepo((s) => s.metas)
  const phase = useRepo((s) => s.phase)
  const root = useMemo(() => buildTree(snapshot?.entries.map((e) => e.path) ?? [], metas), [snapshot, metas])

  return (
    <div className="flex h-full flex-col">
      {header}
      <div
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget || !onContextMenu) return
          e.preventDefault()
          onContextMenu(root, e.clientX, e.clientY)
        }}
      >
        {phase === 'loading' && !snapshot && <p className="px-3 py-2 text-sm text-neutral-500">Loading…</p>}
        {snapshot && root.folders.length === 0 && root.notes.length === 0 && (
          <p className="px-3 py-2 text-sm text-neutral-500">No notes yet.</p>
        )}
        <ul role="tree" aria-label="Folders and notes">
          <FolderChildren folder={root} depth={0} onContextMenu={onContextMenu} />
        </ul>
      </div>
    </div>
  )
}

const FolderChildren = memo(function FolderChildren({
  folder,
  depth,
  onContextMenu,
}: { folder: FolderNode; depth: number } & TreeActions) {
  return (
    <>
      {folder.folders.map((f) => (
        <FolderItem key={f.path} folder={f} depth={depth} onContextMenu={onContextMenu} />
      ))}
      {folder.notes.map((n) => (
        <NoteItem key={n.path} note={n} depth={depth} onContextMenu={onContextMenu} />
      ))}
    </>
  )
})

const rowCls = 'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-neutral-200/70'

function FolderItem({ folder, depth, onContextMenu }: { folder: FolderNode; depth: number } & TreeActions) {
  const open = useUi((s) => !!s.expanded[folder.path])
  const toggle = useUi((s) => s.toggleFolder)
  return (
    <li role="treeitem" aria-expanded={open} aria-label={folder.name}>
      <button
        type="button"
        className={rowCls}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => toggle(folder.path)}
        onContextMenu={(e) => {
          if (!onContextMenu) return
          e.preventDefault()
          onContextMenu(folder, e.clientX, e.clientY)
        }}
        data-path={folder.path}
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <FolderIcon name={folder.icon} open={open} className="shrink-0 text-neutral-600" />
        <span className="truncate">{folder.name}</span>
      </button>
      {open && (
        <ul role="group">
          <FolderChildren folder={folder} depth={depth + 1} onContextMenu={onContextMenu} />
        </ul>
      )}
    </li>
  )
}

function NoteItem({ note, depth, onContextMenu }: { note: NoteNode; depth: number } & TreeActions) {
  const dirty = useRepo((s) => !!s.dirty[note.path])
  const closeSidebarOnMobile = useUi((s) => s.closeSidebarOnMobile)
  return (
    <li role="treeitem" aria-label={note.name}>
      <NavLink
        to={notePathToUrl(note.path)}
        className={({ isActive }) =>
          `${rowCls} ${isActive ? 'bg-indigo-100 text-indigo-900 hover:bg-indigo-100' : ''}`
        }
        style={{ paddingLeft: 8 + depth * 14 + 20 }}
        onClick={closeSidebarOnMobile}
        onContextMenu={(e) => {
          if (!onContextMenu) return
          e.preventDefault()
          onContextMenu(note, e.clientX, e.clientY)
        }}
        data-path={note.path}
      >
        <FileText size={15} className="shrink-0 text-neutral-500" aria-hidden />
        <span className="truncate">{note.name}</span>
        {dirty && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved" />}
      </NavLink>
    </li>
  )
}
