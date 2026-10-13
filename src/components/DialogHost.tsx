import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDialog, type DialogRequest } from '../store/dialog.ts'
import { FolderIcon } from './FolderIcon.tsx'

// The icon picker includes the searchable list of all Lucide icons: load on demand.
const IconPicker = lazy(() => import('./IconPicker.tsx'))

const btn = 'rounded px-3 py-1.5 text-sm font-medium'

/** Renders the active dialog from the dialog store. */
export function DialogHost() {
  const current = useDialog((s) => s.current)
  if (!current) return null
  return <DialogView key={current.title + current.kind} req={current} />
}

function DialogView({ req }: { req: DialogRequest }) {
  const cancel = () => {
    if (req.kind === 'prompt' || req.kind === 'choose') req.resolve(null)
    else if (req.kind === 'confirm') req.resolve(false)
    else req.resolve(undefined)
  }
  return (
    <Modal title={req.title} onCancel={cancel}>
      {req.kind === 'prompt' && <PromptBody req={req} onCancel={cancel} />}
      {req.kind === 'confirm' && (
        <>
          <p className="mb-4 text-sm text-neutral-700">{req.message}</p>
          {req.items && (
            <ul
              aria-label="Changes"
              className="-mt-2 mb-4 max-h-72 overflow-y-auto rounded border border-neutral-200 text-sm"
            >
              {req.items.map((it, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 border-b border-neutral-100 px-2 py-1.5 last:border-b-0"
                >
                  <FolderIcon name={it.icon} note size={16} className="shrink-0 text-neutral-600" />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.detail && <span className="shrink-0 text-xs text-neutral-500">{it.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={`${btn} hover:bg-neutral-100`} onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              className={`${btn} text-white ${req.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              onClick={() => req.resolve(true)}
            >
              {req.confirmLabel}
            </button>
          </div>
        </>
      )}
      {req.kind === 'choose' && <ChooseBody req={req} onCancel={cancel} />}
      {req.kind === 'icon' && (
        <Suspense fallback={<p className="text-sm text-neutral-500">Loading icons…</p>}>
          <IconPicker current={req.current} onPick={req.resolve} onCancel={cancel} />
        </Suspense>
      )}
    </Modal>
  )
}

function PromptBody({
  req,
  onCancel,
}: {
  req: Extract<DialogRequest, { kind: 'prompt' }>
  onCancel: () => void
}) {
  const [value, setValue] = useState(req.initial)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    // Select the name without the extension.
    const dot = req.initial.toLowerCase().endsWith('.md') ? req.initial.length - 3 : req.initial.length
    el.setSelectionRange(0, dot)
  }, [req.initial])
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) req.resolve(value.trim())
      }}
    >
      <label htmlFor="dialog-input" className="mb-1 block text-sm font-medium">
        {req.label}
      </label>
      <input
        id="dialog-input"
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        className="mb-4 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" className={`${btn} hover:bg-neutral-100`} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={!value.trim()}
          className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50`}
        >
          {req.confirmLabel}
        </button>
      </div>
    </form>
  )
}

function ChooseBody({
  req,
  onCancel,
}: {
  req: Extract<DialogRequest, { kind: 'choose' }>
  onCancel: () => void
}) {
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const shown = req.options.filter((o) => o.label.toLowerCase().includes(filter.trim().toLowerCase()))
  const i = Math.min(active, Math.max(0, shown.length - 1))
  return (
    <div>
      <input
        autoFocus
        type="search"
        aria-label={req.label}
        placeholder="Filter folders…"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = shown.length
            if (n) setActive((i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
          } else if (e.key === 'Enter' && shown[i]) {
            e.preventDefault()
            req.resolve(shown[i].value)
          }
        }}
        className="mb-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
      />
      <ul role="listbox" aria-label={req.label} className="mb-3 max-h-64 overflow-y-auto">
        {shown.map((o, k) => (
          <li
            key={o.value}
            role="option"
            aria-selected={k === i}
            onMouseMove={() => k !== i && setActive(k)}
            onClick={() => req.resolve(o.value)}
            className={`cursor-pointer truncate rounded px-2 py-1.5 text-sm ${k === i ? 'bg-indigo-50' : ''}`}
          >
            {o.label}
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-2 py-3 text-center text-sm text-neutral-500">No folders match.</li>
        )}
      </ul>
      <div className="flex justify-end">
        <button type="button" className={`${btn} hover:bg-neutral-100`} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function Modal({
  title,
  onCancel,
  children,
}: {
  title: string
  onCancel: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
      // Minimal focus trap.
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0]!
        const last = f[f.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      prev?.focus?.()
    }
  }, [onCancel])
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl"
      >
        <h2 id="dialog-title" className="mb-3 text-base font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
