import { FilePlus, FolderPlus, ImageIcon, Pencil, Search, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { FolderNode, NoteNode } from '../repo/tree.ts'
import { useUi } from '../store/ui.ts'
import { ContextMenu, type MenuItem } from './ContextMenu.tsx'
import { Sidebar } from './Sidebar.tsx'
import { useTreeActions } from './useTreeActions.ts'

const headerBtn = 'rounded p-1.5 text-neutral-600 hover:bg-neutral-200/70'

/** Sidebar with header buttons, context menus and note/folder operations. */
export function NotesSidebar() {
  const actions = useTreeActions()
  const setQuickOpen = useUi((s) => s.setQuickOpen)
  const [menu, setMenu] = useState<{ node: FolderNode | NoteNode; x: number; y: number } | null>(null)
  const onMenu = useCallback(
    (node: FolderNode | NoteNode, x: number, y: number) => setMenu({ node, x, y }),
    [],
  )
  const close = useCallback(() => setMenu(null), [])
  const { newNote } = actions
  const onNewNote = useCallback((folder: string) => void newNote(folder), [newNote])

  const items = (node: FolderNode | NoteNode): MenuItem[] => {
    if (node.kind === 'note') {
      return [
        { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => void actions.rename(node) },
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
    ]
    if (node.path === '') return create
    return [
      ...create,
      { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => void actions.rename(node) },
      { label: 'Change icon', icon: <ImageIcon size={14} />, onSelect: () => void actions.changeIcon(node) },
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
        header={
          <div className="flex items-center gap-0.5 border-b border-neutral-200 px-2 py-1">
            <button
              type="button"
              onClick={() => setQuickOpen(true)}
              className="mr-auto flex flex-1 items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-200/70"
            >
              <Search size={14} /> Search
              <kbd className="ml-auto hidden font-sans text-xs text-neutral-400 sm:inline">Ctrl K</kbd>
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
