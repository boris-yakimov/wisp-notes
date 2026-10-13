import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { childFolderOf, dirname, isInside, notePathToUrl } from '../repo/paths.ts'
import { useRepo } from '../repo/session.ts'
import { buildTree, hasChildren, type FolderNode, type NoteNode } from '../repo/tree.ts'
import { useUi } from '../store/ui.ts'
import { FolderIcon } from './FolderIcon.tsx'

export interface TreeActions {
  /** Open the context menu for a node at screen coordinates. */
  onMenu?: (node: FolderNode | NoteNode, x: number, y: number) => void
  /** Create a note inside a folder (or under a note: `childFolderOf(note)`). */
  onNewNote?: (folder: string) => void
  /** Move a dragged note/folder into a folder ('' = top level) or under a note (`childFolderOf(note)`). */
  onMove?: (path: string, toFolder: string) => void
}

/** Drag-and-drop payload type for tree items. */
const DND_TYPE = 'application/x-wisp-path'
/** Path being dragged (dataTransfer contents can't be read during dragover). */
let dragging: { path: string; folder: boolean } | null = null

/** Can the dragged item be dropped into `folder`? */
function canDrop(folder: string): boolean {
  if (!dragging) return false
  if (dirname(dragging.path) === folder) return false // already there
  // A folder's contents, or a note's sub-notes, live in `own`: can't drop into itself.
  const own = dragging.folder ? dragging.path : childFolderOf(dragging.path)
  if (folder !== '' && isInside(folder, own)) return false
  return true
}

function dragSource(path: string, folder: boolean, actions: TreeActions) {
  if (!actions.onMove) return {}
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dragging = { path, folder }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(DND_TYPE, path)
      e.dataTransfer.setData('text/plain', path)
    },
    onDragEnd: () => {
      dragging = null
    },
  }
}

/** Drop handlers for a folder target. Hovering a closed folder for a moment expands it. */
function useDropTarget(folder: string, actions: TreeActions, onHoverOpen?: () => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!actions.onMove) return { over: false, handlers: {} }
  const reset = () => {
    depth.current = 0
    setOver(false)
    clearTimeout(timer.current)
  }
  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!canDrop(folder)) return
        e.preventDefault()
        e.stopPropagation()
        if (depth.current++ === 0) {
          setOver(true)
          if (onHoverOpen) timer.current = setTimeout(onHoverOpen, 700)
        }
      },
      onDragOver: (e: React.DragEvent) => {
        if (!canDrop(folder)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!over) return
        e.stopPropagation()
        if (--depth.current <= 0) reset()
      },
      onDrop: (e: React.DragEvent) => {
        const path = e.dataTransfer.getData(DND_TYPE) || dragging?.path
        reset()
        if (!path || !canDrop(folder)) return
        e.preventDefault()
        e.stopPropagation()
        dragging = null
        actions.onMove!(path, folder)
      },
    },
  }
}

/** Folder tree built from the current snapshot. */
export function Sidebar({ onMenu, onNewNote, onMove, header }: TreeActions & { header?: React.ReactNode }) {
  const snapshot = useRepo((s) => s.snapshot)
  const metas = useRepo((s) => s.metas)
  const phase = useRepo((s) => s.phase)
  const root = useMemo(() => {
    const entries = snapshot?.entries ?? []
    return buildTree(
      entries.filter((e) => !e.folder).map((e) => e.path),
      metas,
      entries.filter((e) => e.folder).map((e) => e.path),
    )
  }, [snapshot, metas])
  const actions = useMemo(() => ({ onMenu, onNewNote, onMove }), [onMenu, onNewNote, onMove])
  // Dropping on empty space (or the top-level area) moves to the top level.
  const rootDrop = useDropTarget('', actions)

  return (
    <div className="flex h-full flex-col">
      {header}
      <div
        className={`min-h-0 flex-1 overflow-y-auto py-1 ${rootDrop.over ? 'bg-indigo-50 ring-2 ring-indigo-300 ring-inset' : ''}`}
        data-testid="tree-root"
        {...rootDrop.handlers}
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
  const setExpanded = useUi((s) => s.setExpanded)
  const drop = useDropTarget(folder.path, actions, () => setExpanded(folder.path, true))
  return (
    <li role="treeitem" aria-expanded={open} aria-label={folder.name}>
      <div className="relative" {...drop.handlers}>
        <button
          type="button"
          className={`${rowCls} ${drop.over ? 'bg-indigo-100 ring-2 ring-indigo-400' : ''}`}
          data-drop-target={drop.over || undefined}
          {...dragSource(folder.path, true, actions)}
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
  const sub = childFolderOf(note.path)
  const nested = hasChildren(note)
  const open = useUi((s) => !!s.expanded[sub]) && nested
  const toggle = useUi((s) => s.toggleFolder)
  const setExpanded = useUi((s) => s.setExpanded)
  // Dropping onto a note nests the item under it (like Notion); hovering expands its sub-notes.
  const drop = useDropTarget(sub, actions, () => setExpanded(sub, true))
  const menu = menuHandlers(note, actions)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (nested && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      setExpanded(sub, e.key === 'ArrowRight')
    } else menu.onKeyDown(e)
  }
  return (
    <li role="treeitem" aria-label={note.name} aria-expanded={nested ? open : undefined}>
      <div className="relative" {...drop.handlers}>
        <NavLink
          to={notePathToUrl(note.path)}
          className={({ isActive }) =>
            `${rowCls} ${isActive ? 'bg-indigo-100 text-indigo-900 hover:bg-indigo-100' : ''} ${
              drop.over ? 'bg-indigo-100 ring-2 ring-indigo-400' : ''
            }`
          }
          style={{ paddingLeft: 8 + depth * 14 + 20 }}
          onClick={closeSidebarOnMobile}
          data-path={note.path}
          data-drop-target={drop.over || undefined}
          {...dragSource(note.path, false, actions)}
          {...menu}
          onKeyDown={onKeyDown}
        >
          <FolderIcon name={note.icon} note size={15} className="shrink-0 text-neutral-500" />
          <span className="flex-1 truncate">{note.name}</span>
          {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved" />}
          {actions.onNewNote && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`New sub-note in ${note.name}`}
              className={rowBtnCls}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                actions.onNewNote!(sub)
              }}
            >
              <Plus size={14} />
            </span>
          )}
          <MoreButton node={note} actions={actions} />
        </NavLink>
        {nested && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${note.name}`}
            className="absolute top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:bg-neutral-300/70"
            style={{ left: 8 + depth * 14 - 2 }}
            onClick={() => toggle(sub)}
          >
            <ChevronRight
              size={14}
              className={`transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden
            />
          </button>
        )}
      </div>
      {open && note.children && (
        <ul role="group">
          <FolderChildren folder={note.children} depth={depth + 1} actions={actions} />
        </ul>
      )}
    </li>
  )
}
