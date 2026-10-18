import { FileSearch, Search } from 'lucide-react'
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { dirname, displayPath, notePathToUrl } from '../repo/paths.ts'
import { grepNotes, type GrepHit } from '../search/grep.ts'
import { listItems, markRuns, searchNames, type NameHit } from '../search/names.ts'
import { useUi, type QuickOpenMode } from '../store/ui.ts'
import { FolderIcon } from './FolderIcon.tsx'
import type { NoteNavState } from './NotePage.tsx'
import { QuickOpenPreview } from './QuickOpenPreview.tsx'
import { useNoteContents } from './useNoteContents.ts'
import { useTree } from './useTree.ts'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const WIDE = '(min-width: 768px)'
const NAME_LIMIT = 50
const LINE_LIMIT = 200

/** The preview pane is only shown (and notes only loaded for it) where there is room beside the list. */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.(WIDE)
      mq?.addEventListener('change', cb)
      return () => mq?.removeEventListener('change', cb)
    },
    () => window.matchMedia?.(WIDE).matches ?? true,
  )
}

/**
 * Search palette with a preview pane (like Telescope): fuzzy search of page and folder names
 * (Ctrl/Cmd+K, \ff) or grep inside pages (Ctrl/Cmd+G, \fg). Keyboard navigable.
 */
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

type Hit = NameHit | GrepHit
const hitKey = (h: Hit) => (h.kind === 'line' ? `${h.path}:${h.line}` : h.path)

const MODES: { mode: QuickOpenMode; label: string; shortcut: string }[] = [
  { mode: 'names', label: 'Names', shortcut: 'Ctrl+K' },
  { mode: 'contents', label: 'Contents', shortcut: 'Ctrl+G' },
]

function Palette() {
  const mode = useUi((s) => s.quickOpenMode)
  const setOpen = useUi((s) => s.setQuickOpen)
  const closeSidebarOnMobile = useUi((s) => s.closeSidebarOnMobile)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Start at the top again when switching modes (the query is kept).
  const [shownMode, setShownMode] = useState(mode)
  if (shownMode !== mode) {
    setShownMode(mode)
    setActive(0)
  }
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const root = useTree()
  const wide = useWideScreen()
  const grep = mode === 'contents'
  const contents = useNoteContents(root, grep)
  // Grep can take a moment on large notebooks: keep typing responsive.
  const deferredQuery = useDeferredValue(query)

  const nameResults: NameHit[] = useMemo(() => {
    if (grep) return []
    if (query.trim()) return searchNames(root, query, NAME_LIMIT)
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
      .slice(0, NAME_LIMIT)
  }, [grep, query, root])

  const grepResult = useMemo(() => {
    if (!grep || !contents) return { hits: [], total: 0 }
    const notes = [...contents.notes].sort(
      (a, b) => collator.compare(a.parent, b.parent) || collator.compare(a.name, b.name),
    )
    return grepNotes(notes, deferredQuery, LINE_LIMIT)
  }, [grep, contents, deferredQuery])

  const results: Hit[] = grep ? grepResult.hits : nameResults
  const activeIndex = Math.min(active, Math.max(0, results.length - 1))
  const activeHit = results[activeIndex]

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  const close = () => setOpen(false)
  const choose = (hit: Hit | undefined) => {
    if (!hit) return
    close()
    if (hit.kind === 'folder') {
      revealFolder(hit.path)
      return
    }
    closeSidebarOnMobile()
    const state: NoteNavState | undefined =
      hit.kind === 'line' ? { highlight: hit.match, at: hit.from } : undefined
    navigate(notePathToUrl(hit.path), { state })
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
      choose(activeHit)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`
  const label = grep ? 'Search note contents' : 'Search notes'
  const q = query.trim()
  const emptyText = grep
    ? !q
      ? 'Type to search inside your pages.'
      : !contents
        ? 'Loading pages…'
        : `No page contains “${q}”.`
    : q
      ? `Nothing matches “${q}”.`
      : 'No notes yet.'

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
        aria-label={label}
        className="w-full max-w-xl overflow-hidden rounded-lg bg-white dark:bg-neutral-900 shadow-xl md:max-w-5xl"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 px-3">
          {grep ? (
            <FileSearch size={16} className="shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden />
          ) : (
            <Search size={16} className="shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden />
          )}
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-label={label}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
            placeholder={grep ? 'Search inside pages…' : 'Search pages and folders…'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="w-full py-3 text-base outline-none"
          />
          <div
            role="group"
            aria-label="Search in"
            className="flex shrink-0 gap-0.5 rounded bg-neutral-100 p-0.5 dark:bg-neutral-800"
          >
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                aria-pressed={mode === m.mode}
                title={`${m.label} (${m.shortcut})`}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => {
                  useUi.getState().setQuickOpen(true, m.mode)
                  inputRef.current?.focus()
                }}
                className={`rounded px-2 py-0.5 text-xs ${
                  mode === m.mode
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex md:h-[60vh]">
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label="Results"
            className="max-h-[60vh] w-full overflow-y-auto py-1 md:max-h-none md:w-2/5 md:shrink-0 md:border-r md:border-neutral-200 md:dark:border-neutral-800"
          >
            {results.map((hit, i) => (
              <li
                key={hitKey(hit)}
                id={optionId(i)}
                data-index={i}
                data-kind={hit.kind}
                role="option"
                aria-selected={i === activeIndex}
                onMouseMove={() => i !== activeIndex && setActive(i)}
                onClick={() => choose(hit)}
                className={`cursor-pointer px-3 py-2 ${i === activeIndex ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''}`}
              >
                {hit.kind === 'line' ? <LineRow hit={hit} /> : <NameRow hit={hit} />}
              </li>
            ))}
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                {emptyText}
              </li>
            )}
          </ul>
          {wide && (
            <div className="min-w-0 flex-1">
              <QuickOpenPreview
                hit={
                  activeHit &&
                  (activeHit.kind === 'line' ? { kind: 'note', path: activeHit.path } : activeHit)
                }
                match={activeHit?.kind === 'line' ? { from: activeHit.from, to: activeHit.to } : undefined}
                root={root}
              />
            </div>
          )}
        </div>
        <div className="hidden gap-3 border-t border-neutral-200 dark:border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 dark:text-neutral-500 sm:flex">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span>{grep ? 'Ctrl+K search names' : 'Ctrl+G search contents'}</span>
          {grep && (
            <span className="ml-auto" data-testid="grep-status">
              {grepResult.total > grepResult.hits.length
                ? `${grepResult.hits.length} of ${grepResult.total} lines`
                : q && contents
                  ? `${grepResult.total} ${grepResult.total === 1 ? 'line' : 'lines'}`
                  : ''}
              {contents &&
                contents.missing > 0 &&
                ` · ${contents.missing} ${contents.missing === 1 ? 'page' : 'pages'} not downloaded yet`}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function NameRow({ hit }: { hit: NameHit }) {
  return (
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
  )
}

function LineRow({ hit }: { hit: GrepHit }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <FolderIcon
          name={hit.icon}
          note
          size={14}
          className="shrink-0 text-neutral-400 dark:text-neutral-500"
        />
        <span className="truncate text-sm font-medium">{hit.name}</span>
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">:{hit.line}</span>
        {hit.parent && (
          <span className="ml-auto shrink-0 truncate text-xs text-neutral-400 dark:text-neutral-500">
            {hit.parent}
          </span>
        )}
      </div>
      <p
        className="mt-0.5 truncate pl-6 font-mono text-xs text-neutral-600 dark:text-neutral-400"
        data-testid="line"
      >
        <Marked text={hit.text} indices={hit.textMatches} />
      </p>
    </>
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
