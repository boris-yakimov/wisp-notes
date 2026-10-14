import { Link } from 'react-router'
import { notePathToUrl } from '../repo/paths.ts'
import { findNote, type NoteNode } from '../repo/tree.ts'
import { FolderIcon } from './FolderIcon.tsx'
import { useTree } from './useTree.ts'

/** Links to a note's sub-pages, shown above the editor (derived from the tree, not stored in the note). */
export function SubPages({ path }: { path: string }) {
  const note = findNote(useTree(), path)
  const subs = (note?.children?.items ?? []).filter((n): n is NoteNode => n.kind === 'note')
  if (!subs.length) return null
  return (
    <nav
      aria-label="Sub-pages"
      className="shrink-0 border-b border-neutral-200 py-1.5 dark:border-neutral-800"
    >
      <ul className="mx-auto flex max-w-[46rem] flex-wrap px-4 items-center gap-x-1 gap-y-1 text-sm">
        <li className="mr-1 pl-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          {subs.length} sub-page{subs.length === 1 ? '' : 's'}:
        </li>
        {subs.map((n) => (
          <li key={n.path}>
            <Link
              to={notePathToUrl(n.path)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-neutral-700 hover:bg-neutral-100 hover:text-indigo-600 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-indigo-400"
            >
              <FolderIcon
                name={n.icon}
                note
                size={14}
                className="shrink-0 text-neutral-500 dark:text-neutral-400"
              />
              {n.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
