import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic'
import { useMemo, useState } from 'react'
import { filterIcons } from './iconSearch.ts'

interface Props {
  current: string | undefined
  /** Icon name, or null to remove the icon. */
  onPick: (icon: string | null) => void
  onCancel: () => void
}

/** Searchable grid of Lucide icons. Lazy-loaded (see DialogHost); each icon loads as its own tiny chunk. */
export default function IconPicker({ current, onPick, onCancel }: Props) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => filterIcons(iconNames, query), [query])
  return (
    <div>
      <input
        type="search"
        autoFocus
        aria-label="Search icons"
        placeholder="Search icons (e.g. book, home, star)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) {
            e.preventDefault()
            onPick(matches[0])
          }
        }}
        className="mb-3 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
      />
      <div role="listbox" aria-label="Icons" className="grid max-h-72 grid-cols-8 gap-1 overflow-y-auto">
        {matches.map((name) => (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={name === current}
            aria-label={name}
            title={name}
            onClick={() => onPick(name)}
            className={`flex aspect-square items-center justify-center rounded hover:bg-neutral-100 ${
              name === current ? 'bg-indigo-100 text-indigo-800' : 'text-neutral-700'
            }`}
          >
            <DynamicIcon name={name as IconName} size={18} />
          </button>
        ))}
      </div>
      {matches.length === 0 && (
        <p className="py-4 text-center text-sm text-neutral-500">No icons match “{query}”.</p>
      )}
      <div className="mt-3 flex justify-between">
        <button
          type="button"
          onClick={() => onPick(null)}
          disabled={!current}
          className="rounded px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
        >
          Remove icon
        </button>
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-100">
          Cancel
        </button>
      </div>
    </div>
  )
}
