import { ChevronRight, FileText, MoreHorizontal, Plus } from 'lucide-react'
import { memo, useMemo } from 'react'
import { NavLink } from 'react-router'
import { notePathToUrl } from '../repo/paths.ts'
import { useRepo } from '../repo/session.ts'
import { buildTree, type FolderNode, type NoteNode } from '../repo/tree.ts'
import { useUi } from '../store/ui.ts'
import { FolderIcon } from './FolderIcon.tsx'

export interface TreeActions {
  /** Open the context menu for a node at screen coordinates. */
  onMenu?: (node: FolderNode | NoteNode, x: number, y: number) => void
  /** Create a note inside a folder. */
  onNewNote?: (folder: string) => void
}

/** Folder tree built from the current snapshot. */
export function Sidebar({ onMenu, onNewNote, header }: TreeActions & { header?: React.ReactNode }) {
  const snapshot = useRepo((s) => s.snapshot)
  const metas = useRepo((s) => s.metas)
  const phase = useRepo((s) => s.phase)
  const root = useMemo(() => buildTree(snapshot?.entries.map((e) => e.path) ?? [], metas), [snapshot, metas])
  const actions = useMemo(() => ({ onMenu, onNewNote }), [onMenu, onNewNote])

  return (
    <div className="flex h-full flex-col">
      {header}
      <div
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onContextMenu={(e) => {
          if (!onMenu || (e.target as HTMLElement).closest('[role=treeitem]')) return
          e.preventDefault()
          onMenu(root, e.clientX, e.clientY)
        }}
      >
        {phase === 'loading' && !snapshot && <p className="px-3 py-2 text-sm text-neutral-500">Loading…</p>}
        {snapshot && root.folders.length === 0 && root.notes.length === 0 && (
          <p className="px-3 py-2 text-sm text-neutral-500">No notes yet.</p>
        )}
        <ul role="tree" aria-label="Folders and notes">
          <FolderChildren folder={root} depth={0} actions={actions} />
        </ul>
      </div>
    </div>
  )
}

interface ItemProps {
  depth: number
  actions: TreeActions
}

const FolderChildren = memo(function FolderChildren({
  folder,
  depth,
  actions,
}: ItemProps & { folder: FolderNode }) {
  return (
    <>
      {folder.folders.map((f) => (
        <FolderItem key={f.path} folder={f} depth={depth} actions={actions} />
      ))}
      {folder.notes.map((n) => (
        <NoteItem key={n.path} note={n} depth={depth} actions={actions} />
      ))}
    </>
  )
})

const rowCls =
  'group flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-neutral-200/70 focus-visible:outline-2 focus-visible:outline-indigo-500'
// Visible on hover/focus with a mouse; always visible on touch screens.
const rowBtnCls =
  'shrink-0 rounded p-0.5 text-neutral-500 opacity-0 hover:bg-neutral-300/70 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'

function menuHandlers(node: FolderNode | NoteNode, actions: TreeActions) {
  return {
    onContextMenu: (e: React.MouseEvent) => {
      if (!actions.onMenu) return
      e.preventDefault()
      actions.onMenu(node, e.clientX, e.clientY)
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!actions.onMenu) return
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault()
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        actions.onMenu(node, r.left + 24, r.bottom)
      }
    },
  }
}

function MoreButton({ node, actions }: { node: FolderNode | NoteNode; actions: TreeActions }) {
  if (!actions.onMenu) return null
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={`Actions for ${node.name}`}
      className={rowBtnCls}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        actions.onMenu!(node, r.left, r.bottom + 2)
      }}
    >
      <MoreHorizontal size={14} />
    </span>
  )
}

function FolderItem({ folder, depth, actions }: ItemProps & { folder: FolderNode }) {
  const open = useUi((s) => !!s.expanded[folder.path])
  const toggle = useUi((s) => s.toggleFolder)
  return (
    <li role="treeitem" aria-expanded={open} aria-label={folder.name}>
      <div className="relative">
        <button
          type="button"
          className={rowCls}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggle(folder.path)}
          data-path={folder.path}
          {...menuHandlers(folder, actions)}
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
          <FolderIcon name={folder.icon} open={open} className="shrink-0 text-neutral-600" />
          <span className="flex-1 truncate">{folder.name}</span>
          {actions.onNewNote && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`New note in ${folder.name}`}
              className={rowBtnCls}
              onClick={(e) => {
                e.stopPropagation()
                actions.onNewNote!(folder.path)
              }}
            >
              <Plus size={14} />
            </span>
          )}
          <MoreButton node={folder} actions={actions} />
        </button>
      </div>
      {open && (
        <ul role="group">
          <FolderChildren folder={folder} depth={depth + 1} actions={actions} />
        </ul>
      )}
    </li>
  )
}

function NoteItem({ note, depth, actions }: ItemProps & { note: NoteNode }) {
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
        data-path={note.path}
        {...menuHandlers(note, actions)}
      >
        <FileText size={15} className="shrink-0 text-neutral-500" aria-hidden />
        <span className="flex-1 truncate">{note.name}</span>
        {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved" />}
        <MoreButton node={note} actions={actions} />
      </NavLink>
    </li>
  )
}
