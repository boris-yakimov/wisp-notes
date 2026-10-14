import {
  FilePlus,
  FolderInput,
  FolderOutput,
  FolderPlus,
  ImageIcon,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { childFolderOf } from '../repo/paths.ts'
import type { FolderNode, NoteNode } from '../repo/tree.ts'
import { useUi } from '../store/ui.ts'
import { ContextMenu, type MenuItem } from './ContextMenu.tsx'
import { Sidebar } from './Sidebar.tsx'
import { useImportPicker } from './useImportPicker.ts'
import { useTreeActions } from './useTreeActions.ts'

const headerBtn =
  'rounded p-1.5 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-700/70'

/** Sidebar with header buttons, context menus and note/folder operations. */
export function NotesSidebar() {
  const actions = useTreeActions()
  const pickImport = useImportPicker()
  const setQuickOpen = useUi((s) => s.setQuickOpen)
  const [menu, setMenu] = useState<{ node: FolderNode | NoteNode; x: number; y: number } | null>(null)
  const onMenu = useCallback(
    (node: FolderNode | NoteNode, x: number, y: number) => setMenu({ node, x, y }),
    [],
  )
  const close = useCallback(() => setMenu(null), [])
  const { newNote, move, rename } = actions
  const onNewNote = useCallback((folder: string) => void newNote(folder), [newNote])
  const onMove = useCallback((path: string, toFolder: string) => void move(path, toFolder), [move])
  const onRename = useCallback((node: FolderNode | NoteNode) => void rename(node), [rename])

  const autoItem = (node: FolderNode | NoteNode): MenuItem => ({
    label: 'Auto-assign icons',
    icon: <Sparkles size={14} />,
    onSelect: () => void actions.autoIcons(node),
  })

  const items = (node: FolderNode | NoteNode): MenuItem[] => {
    if (node.kind === 'note') {
      return [
        {
          label: 'New sub-note',
          icon: <FilePlus size={14} />,
          onSelect: () => void actions.newNote(childFolderOf(node.path)),
        },
        {
          label: 'Import files as sub-notes…',
          icon: <Upload size={14} />,
          onSelect: () => pickImport(childFolderOf(node.path), 'files'),
        },
        {
          label: 'Import folder contents as sub-notes…',
          icon: <FolderInput size={14} />,
          onSelect: () => pickImport(childFolderOf(node.path), 'contents'),
        },
        { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => void actions.rename(node) },
        { label: 'Move to…', icon: <FolderOutput size={14} />, onSelect: () => void actions.moveTo(node) },
        {
          label: 'Change icon',
          icon: <ImageIcon size={14} />,
          onSelect: () => void actions.changeIcon(node),
        },
        autoItem(node),
        {
          label: 'Delete',
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => void actions.remove(node),
        },
      ]
    }
    const create: MenuItem[] = [
      { label: 'New note', icon: <FilePlus size={14} />, onSelect: () => void actions.newNote(node.path) },
      {
        label: 'New folder',
        icon: <FolderPlus size={14} />,
        onSelect: () => void actions.newFolder(node.path),
      },
      { label: 'Import files…', icon: <Upload size={14} />, onSelect: () => pickImport(node.path, 'files') },
      {
        label: 'Import folder…',
        icon: <FolderInput size={14} />,
        onSelect: () => pickImport(node.path, 'folder'),
      },
    ]
    if (node.path === '') return [...create, autoItem(node)]
    return [
      ...create,
      { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => void actions.rename(node) },
      { label: 'Move to…', icon: <FolderOutput size={14} />, onSelect: () => void actions.moveTo(node) },
      { label: 'Change icon', icon: <ImageIcon size={14} />, onSelect: () => void actions.changeIcon(node) },
      autoItem(node),
      {
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: () => void actions.remove(node),
      },
    ]
  }

  return (
    <>
      <Sidebar
        onMenu={onMenu}
        onNewNote={onNewNote}
        onMove={onMove}
        onRename={onRename}
        header={
          <div className="flex items-center gap-0.5 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1">
            <button
              type="button"
              onClick={() => setQuickOpen(true)}
              className="mr-auto flex flex-1 items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-700/70"
            >
              <Search size={14} /> Search
              <kbd className="ml-auto hidden font-sans text-xs text-neutral-400 dark:text-neutral-500 sm:inline">
                Ctrl K
              </kbd>
            </button>
            <button
              type="button"
              aria-label="New note"
              title="New note"
              className={headerBtn}
              onClick={() => void actions.newNote('')}
            >
              <FilePlus size={16} />
            </button>
            <button
              type="button"
              aria-label="New folder"
              title="New folder"
              className={headerBtn}
              onClick={() => void actions.newFolder('')}
            >
              <FolderPlus size={16} />
            </button>
            <button
              type="button"
              aria-label="Import folder"
              title="Import a folder (e.g. a Notion export)"
              className={headerBtn}
              onClick={() => pickImport('', 'folder')}
            >
              <FolderInput size={16} />
            </button>
          </div>
        }
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.node.path ? `Actions for ${menu.node.name}` : 'Actions'}
          items={items(menu.node)}
          onClose={close}
        />
      )}
    </>
  )
}
