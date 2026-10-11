import { FileText, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { dirname, isNotePath, noteTitle, notePathToUrl } from '../repo/paths.ts'
import { useRepo } from '../repo/session.ts'
import { highlightParts, type SearchHit } from '../search/index.ts'
import type { SearchService } from '../search/service.ts'
import { useUi } from '../store/ui.ts'
import type { NoteNavState } from './NotePage.tsx'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Ctrl/Cmd+K palette: search note titles and contents, keyboard navigable. */
export function QuickOpen({ search }: { search: SearchService }) {
  const open = useUi((s) => s.quickOpen)
  if (!open) return null
  return <Palette search={search} />
}

function Palette({ search }: { search: SearchService }) {
  const setOpen = useUi((s) => s.setQuickOpen)
  const closeSidebarOnMobile = useUi((s) => s.closeSidebarOnMobile)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const snapshot = useRepo((s) => s.snapshot)
  // Re-render when the index changes (background prefetch finishing, edits).
  const indexVersion = useSyncExternalStore(
    (cb) => search.onChange(cb),
    () => search.version,
  )

  const results: SearchHit[] = useMemo(() => {
    if (query.trim()) return search.index.search(query, 50)
    // Empty query: all notes alphabetically.
    return (snapshot?.entries ?? [])
      .filter((e) => isNotePath(e.path))
      .map((e) => ({ path: e.path, title: noteTitle(e.path), score: 0, terms: [], snippet: null }))
      .sort((a, b) => collator.compare(a.title, b.title))
      .slice(0, 50)
  }, [query, search, snapshot, indexVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeIndex = Math.min(active, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  const close = () => setOpen(false)
  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return
    close()
    closeSidebarOnMobile()
    const highlight = hit.snippet
      ? hit.snippet.text.slice(hit.snippet.matchStart, hit.snippet.matchEnd)
      : undefined
    navigate(notePathToUrl(hit.path), { state: { highlight } satisfies NoteNavState })
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

  const terms = query.trim()
    ? [...new Set(results.flatMap((r) => r.terms).concat(query.trim().split(/\s+/)))]
    : []
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
        className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3">
          <Search size={16} className="shrink-0 text-neutral-400" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-label="Search notes"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
            placeholder="Search notes…"
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
              role="option"
              aria-selected={i === activeIndex}
              onMouseMove={() => i !== activeIndex && setActive(i)}
              onClick={() => choose(hit)}
              className={`cursor-pointer px-3 py-2 ${i === activeIndex ? 'bg-indigo-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <FileText size={14} className="shrink-0 text-neutral-400" aria-hidden />
                <span className="truncate text-sm font-medium">
                  <Highlighted text={hit.title} terms={terms} />
                </span>
                {dirname(hit.path) && (
                  <span className="ml-auto shrink-0 truncate text-xs text-neutral-400">
                    {dirname(hit.path)}
                  </span>
                )}
              </div>
              {hit.snippet && (
                <p className="mt-0.5 truncate pl-6 text-xs text-neutral-600" data-testid="snippet">
                  {hit.snippet.text.slice(0, hit.snippet.matchStart)}
                  <mark className="rounded-sm bg-yellow-200 text-inherit">
                    {hit.snippet.text.slice(hit.snippet.matchStart, hit.snippet.matchEnd)}
                  </mark>
                  {hit.snippet.text.slice(hit.snippet.matchEnd)}
                </p>
              )}
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-neutral-500">
              {query.trim() ? `No notes match “${query.trim()}”.` : 'No notes yet.'}
            </li>
          )}
        </ul>
        <div className="hidden gap-3 border-t border-neutral-200 px-3 py-1.5 text-xs text-neutral-400 sm:flex">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-yellow-200 text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
