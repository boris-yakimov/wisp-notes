import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDialog, type DialogRequest } from '../store/dialog.ts'

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
    if (req.kind === 'prompt') req.resolve(null)
    else if (req.kind === 'confirm') req.resolve(false)
    else req.resolve(undefined)
  }
  return (
    <Modal title={req.title} onCancel={cancel}>
      {req.kind === 'prompt' && <PromptBody req={req} onCancel={cancel} />}
      {req.kind === 'confirm' && (
        <>
          <p className="mb-4 text-sm text-neutral-700">{req.message}</p>
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
