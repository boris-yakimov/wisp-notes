import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { childFolderOf, dirname, isInside, notePathToUrl, urlToNotePath } from '../repo/paths.ts'
import { useRepo } from '../repo/session.ts'
import { hasChildren, type FolderNode, type NoteNode } from '../repo/tree.ts'
import { useUi } from '../store/ui.ts'
import { FolderIcon } from './FolderIcon.tsx'
import { useTree } from './useTree.ts'

export interface TreeActions {
  /** Open the context menu for a node at screen coordinates. */
  onMenu?: (node: FolderNode | NoteNode, x: number, y: number) => void
  /** Create a note inside a folder (or under a note: `childFolderOf(note)`). */
  onNewNote?: (folder: string) => void
  /** Move a dragged note/folder into a folder ('' = top level) or under a note (`childFolderOf(note)`). */
  onMove?: (path: string, toFolder: string) => void
  /** Rename a note or folder (F2 on its row). */
  onRename?: (node: FolderNode | NoteNode) => void
  /** Reorder: put a dragged item right before/after `target` (moving it into target's container). */
  onPlace?: (path: string, target: string, where: 'before' | 'after') => void
  /** Move an item up (-1) or down (+1) among its siblings (Alt+↑/↓). */
  onShift?: (path: string, delta: -1 | 1) => void
}

type Zone = 'into' | 'before' | 'after'

/** Can the dragged item be placed next to `target` (reorder)? */
function canPlace(target: string): boolean {
  if (!dragging || dragging.path === target) return false
  const own = dragging.folder ? dragging.path : childFolderOf(dragging.path)
  const container = dirname(target)
  return !(container !== '' && isInside(container, own))
}

/** Top and bottom quarter of a row place before/after it; the middle drops into it. */
function zoneAt(e: React.DragEvent, allowInto: boolean): Zone {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const y = (e.clientY - r.top) / (r.height || 1)
  const edge = allowInto ? 0.25 : 0.5
  if (y < edge) return 'before'
  if (y > 1 - edge) return 'after'
  return 'into'
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

/**
 * Drop handlers for a row (or the empty area: `place` omitted). Dropping in the middle moves the item
 * into `into` (a folder, or under a note); near the top/bottom edge of a row it is placed before/after
 * that row. Hovering a closed folder for a moment expands it.
 */
function useDropTarget(into: string, actions: TreeActions, onHoverOpen?: () => void, place?: string) {
  const [over, setOver] = useState<Zone | null>(null)
  const depth = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!actions.onMove) return { over: null, handlers: {} }
  const zone = (e: React.DragEvent): Zone | null => {
    if (!dragging) return null
    const z = place && actions.onPlace ? zoneAt(e, canDrop(into)) : 'into'
    if (z === 'into') return canDrop(into) ? 'into' : null
    return canPlace(place!) ? z : null
  }
  const reset = () => {
    depth.current = 0
    setOver(null)
    clearTimeout(timer.current)
  }
  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        const z = zone(e)
        if (!z) return
        e.preventDefault()
        e.stopPropagation()
        if (depth.current++ === 0 && onHoverOpen && z === 'into') timer.current = setTimeout(onHoverOpen, 700)
        setOver(z)
      },
      onDragOver: (e: React.DragEvent) => {
        const z = zone(e)
        if (!z) {
          if (over) setOver(null)
          return
        }
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        if (z !== over) setOver(z)
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!over) return
        e.stopPropagation()
        if (--depth.current <= 0) reset()
      },
      onDrop: (e: React.DragEvent) => {
        const path = e.dataTransfer.getData(DND_TYPE) || dragging?.path
        const z = zone(e)
        reset()
        if (!path || !z) return
        e.preventDefault()
        e.stopPropagation()
        dragging = null
        if (z === 'into') actions.onMove!(path, into)
        else actions.onPlace!(path, place!, z)
      },
    },
  }
}

/** Line shown where a dragged item would be placed. */
function DropLine({ zone }: { zone: Zone | null }) {
  if (zone !== 'before' && zone !== 'after') return null
  return (
    <div
      aria-hidden
      data-drop-line={zone}
      className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded bg-indigo-500 ${zone === 'before' ? '-top-px' : '-bottom-px'}`}
    />
  )
}

/**
 * Keep the open note's row in view (centered) after opening a note, e.g. when the app loads on a deep
 * link: while the tree is still settling (cached tree, then Drive's, then the saved order and icons
 * from `_meta.json`, folders expanding) the row can move, so it's revealed again after each change.
 * Stops once you scroll or click in the sidebar yourself. Rows already visible don't move.
 */
function useRevealActiveNote() {
  const scroller = useRef<HTMLDivElement>(null)
  const path = urlToNotePath(useLocation().pathname)
  const snapshot = useRepo((s) => s.snapshot)
  const metas = useRepo((s) => s.metas)
  const expanded = useUi((s) => s.expanded)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  /** The sidebar was scrolled/used by hand since this note was opened. */
  const userMoved = useRef(false)
  useEffect(() => {
    userMoved.current = false
  }, [path, sidebarOpen])
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const stop = () => (userMoved.current = true)
    const events = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const
    for (const e of events) box.addEventListener(e, stop, { passive: true })
    return () => events.forEach((e) => box.removeEventListener(e, stop))
  }, [])
  useEffect(() => {
    const box = scroller.current
    if (!path || !box || !sidebarOpen || userMoved.current) return
    // After layout of this render (React effects can run before the browser has laid out the rows).
    const frame = requestAnimationFrame(() => {
      if (userMoved.current) return
      const row = [...box.querySelectorAll<HTMLElement>('a[data-path]')].find((a) => a.dataset.path === path)
      if (!row) return // not rendered yet: tried again when the tree or expanded folders change
      const b = box.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      if (r.top >= b.top && r.bottom <= b.bottom) return
      box.scrollTop += r.top - b.top - (b.height - r.height) / 2
    })
    return () => cancelAnimationFrame(frame)
  }, [path, snapshot, metas, expanded, sidebarOpen])
  return scroller
}

/** Folder tree built from the current snapshot. */
export function Sidebar({
  onMenu,
  onNewNote,
  onMove,
  onRename,
  onPlace,
  onShift,
  header,
}: TreeActions & { header?: React.ReactNode }) {
  const snapshot = useRepo((s) => s.snapshot)
  const phase = useRepo((s) => s.phase)
  const root = useTree()
  const actions = useMemo(
    () => ({ onMenu, onNewNote, onMove, onRename, onPlace, onShift }),
    [onMenu, onNewNote, onMove, onRename, onPlace, onShift],
  )
  // Dropping on empty space (or the top-level area) moves to the top level.
  const rootDrop = useDropTarget('', actions)
  const scrollRef = useRevealActiveNote()

  return (
    <div className="flex h-full flex-col">
      {header}
      <div
        ref={scrollRef}
        className={`min-h-0 flex-1 overflow-y-auto py-1 ${rootDrop.over ? 'bg-indigo-50 dark:bg-indigo-950/50 ring-2 ring-indigo-300 dark:ring-indigo-700 ring-inset' : ''}`}
        data-testid="tree-root"
        {...rootDrop.handlers}
        onContextMenu={(e) => {
          if (!onMenu || (e.target as HTMLElement).closest('[role=treeitem]')) return
          e.preventDefault()
          onMenu(root, e.clientX, e.clientY)
        }}
      >
        {phase === 'loading' && !snapshot && (
          <p className="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
        )}
        {snapshot && root.folders.length === 0 && root.notes.length === 0 && (
          <p className="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">No notes yet.</p>
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
      {folder.items.map((n) =>
        n.kind === 'folder' ? (
          <FolderItem key={n.path} folder={n} depth={depth} actions={actions} />
        ) : (
          <NoteItem key={n.path} note={n} depth={depth} actions={actions} />
        ),
      )}
    </>
  )
})

const rowCls =
  'group flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-neutral-200/70 dark:hover:bg-neutral-700/70 focus-visible:outline-2 focus-visible:outline-indigo-500'
// Visible on hover/focus with a mouse; always visible on touch screens.
const rowBtnCls =
  'shrink-0 rounded p-0.5 text-neutral-500 dark:text-neutral-400 opacity-0 hover:bg-neutral-300/70 dark:hover:bg-neutral-600/70 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'

function menuHandlers(node: FolderNode | NoteNode, actions: TreeActions) {
  return {
    onContextMenu: (e: React.MouseEvent) => {
      if (!actions.onMenu) return
      e.preventDefault()
      actions.onMenu(node, e.clientX, e.clientY)
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        actions.onShift
      ) {
        e.preventDefault()
        actions.onShift(node.path, e.key === 'ArrowUp' ? -1 : 1)
        return
      }
      if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && actions.onRename) {
        e.preventDefault()
        actions.onRename(node)
        return
      }
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
  const drop = useDropTarget(folder.path, actions, () => setExpanded(folder.path, true), folder.path)
  return (
    <li role="treeitem" aria-expanded={open} aria-label={folder.name}>
      <div className="relative" {...drop.handlers}>
        <button
          type="button"
          className={`${rowCls} ${drop.over === 'into' ? 'bg-indigo-100 dark:bg-indigo-900/50 ring-2 ring-indigo-400' : ''}`}
          data-drop-target={drop.over === 'into' || undefined}
          {...dragSource(folder.path, true, actions)}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggle(folder.path)}
          data-path={folder.path}
          {...menuHandlers(folder, actions)}
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-neutral-400 dark:text-neutral-500 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
          <FolderIcon
            name={folder.icon}
            open={open}
            className="shrink-0 text-neutral-600 dark:text-neutral-400"
          />
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
        <DropLine zone={drop.over} />
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
  const drop = useDropTarget(sub, actions, () => setExpanded(sub, true), note.path)
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
            `${rowCls} ${isActive ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-900 dark:text-indigo-100 hover:bg-indigo-100 dark:hover:bg-indigo-900/50' : ''} ${
              drop.over === 'into' ? 'bg-indigo-100 dark:bg-indigo-900/50 ring-2 ring-indigo-400' : ''
            }`
          }
          style={{ paddingLeft: 8 + depth * 14 + 20 }}
          onClick={closeSidebarOnMobile}
          data-path={note.path}
          data-drop-target={drop.over === 'into' || undefined}
          {...dragSource(note.path, false, actions)}
          {...menu}
          onKeyDown={onKeyDown}
        >
          <FolderIcon
            name={note.icon}
            note
            size={15}
            className="shrink-0 text-neutral-500 dark:text-neutral-400"
          />
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
        <DropLine zone={drop.over} />
        {nested && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${note.name}`}
            className="absolute top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 dark:text-neutral-500 hover:bg-neutral-300/70 dark:hover:bg-neutral-600/70"
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
