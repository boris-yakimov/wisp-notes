import { Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { dirname, displayPath, notePathToUrl } from '../repo/paths.ts'
import { listItems, markRuns, searchNames, type NameHit } from '../search/names.ts'
import { useUi } from '../store/ui.ts'
import { FolderIcon } from './FolderIcon.tsx'
import { useTree } from './useTree.ts'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Ctrl/Cmd+K palette: fuzzy search note and folder names, keyboard navigable. */
export function QuickOpen() {
  const open = useUi((s) => s.quickOpen)
  if (!open) return null
  return <Palette />
}

/** Expand a folder (and its parents) in the sidebar, open the sidebar and focus the folder's row. */
function revealFolder(path: string) {
  const ui = useUi.getState()
  ui.expandTo(path)
  ui.setExpanded(path, true)
  ui.setSidebarOpen(true)
  // After the sidebar has rendered the (newly expanded) row.
  requestAnimationFrame(() => {
    const row = [...document.querySelectorAll<HTMLElement>('button[data-path]')].find(
      (b) => b.dataset.path === path,
    )
    row?.scrollIntoView?.({ block: 'center' })
    row?.focus()
  })
}

function Palette() {
  const setOpen = useUi((s) => s.setQuickOpen)
  const closeSidebarOnMobile = useUi((s) => s.closeSidebarOnMobile)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const root = useTree()

  const results: NameHit[] = useMemo(() => {
    if (query.trim()) return searchNames(root, query, 50)
    // Empty query: all notes alphabetically.
    return listItems(root)
      .filter((n) => n.kind === 'note')
      .map((n) => ({
        kind: n.kind,
        path: n.path,
        name: n.name,
        icon: n.icon,
        parent: displayPath(dirname(n.path)),
        score: 0,
        nameMatches: [],
        parentMatches: [],
      }))
      .sort((a, b) => collator.compare(a.name, b.name))
      .slice(0, 50)
  }, [query, root])

  const activeIndex = Math.min(active, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  const close = () => setOpen(false)
  const choose = (hit: NameHit | undefined) => {
    if (!hit) return
    close()
    if (hit.kind === 'folder') {
      revealFolder(hit.path)
      return
    }
    closeSidebarOnMobile()
    navigate(notePathToUrl(hit.path))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = results.length
    const move = (d: number) => {
      e.preventDefault()
      if (n) setActive((activeIndex + d + n) % n)
    }
    if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'n' || e.key === 'j'))) move(1)
    else if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'p' || e.key === 'k'))) move(-1)
    else if (e.key === 'PageDown') move(Math.min(8, n - 1 - activeIndex) || 0)
    else if (e.key === 'PageUp') move(-Math.min(8, activeIndex) || 0)
    else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-2 pt-[8vh] sm:p-4 sm:pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search notes"
        className="w-full max-w-xl overflow-hidden rounded-lg bg-white dark:bg-neutral-900 shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 px-3">
          <Search size={16} className="shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-label="Search notes"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
            placeholder="Search pages and folders…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="w-full py-3 text-base outline-none"
          />
        </div>
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="max-h-[60vh] overflow-y-auto py-1"
        >
          {results.map((hit, i) => (
            <li
              key={hit.path}
              id={optionId(i)}
              data-index={i}
              data-kind={hit.kind}
              role="option"
              aria-selected={i === activeIndex}
              onMouseMove={() => i !== activeIndex && setActive(i)}
              onClick={() => choose(hit)}
              className={`cursor-pointer px-3 py-2 ${i === activeIndex ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <FolderIcon
                  name={hit.icon}
                  note={hit.kind === 'note'}
                  size={14}
                  className="shrink-0 text-neutral-400 dark:text-neutral-500"
                />
                <span className="truncate text-sm font-medium">
                  <Marked text={hit.name} indices={hit.nameMatches} />
                </span>
                {hit.parent && (
                  <span className="ml-auto shrink-0 truncate text-xs text-neutral-400 dark:text-neutral-500">
                    <Marked text={hit.parent} indices={hit.parentMatches} />
                  </span>
                )}
              </div>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              {query.trim() ? `Nothing matches “${query.trim()}”.` : 'No notes yet.'}
            </li>
          )}
        </ul>
        <div className="hidden gap-3 border-t border-neutral-200 dark:border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 dark:text-neutral-500 sm:flex">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

function Marked({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>
  return (
    <>
      {markRuns(text, indices).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-yellow-200 dark:bg-yellow-700/60 text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
