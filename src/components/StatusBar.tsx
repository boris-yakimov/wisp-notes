import { AlertTriangle, Check, CloudOff, Loader2, X } from 'lucide-react'
import { dismissNotice, useRepo } from '../repo/session.ts'
import { useUi } from '../store/ui.ts'

const labels = {
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  offline: 'Offline',
  error: 'Save failed',
} as const

/** Save status pill for the top bar: Saved / Unsaved / Saving / Offline / Error. */
export function SaveStatus() {
  const status = useRepo((s) => s.saveStatus)
  const error = useRepo((s) => s.saveError)
  const online = useRepo((s) => s.online)
  const shown = !online && status === 'saved' ? 'offline' : status
  const icon = {
    saved: <Check size={14} />,
    unsaved: <span className="h-2 w-2 rounded-full bg-amber-500" />,
    saving: <Loader2 size={14} className="animate-spin" />,
    offline: <CloudOff size={14} />,
    error: <AlertTriangle size={14} />,
  }[shown]
  const color = {
    saved: 'text-neutral-500',
    unsaved: 'text-amber-700',
    saving: 'text-neutral-600',
    offline: 'text-neutral-700 bg-neutral-100',
    error: 'text-red-700 bg-red-50',
  }[shown]
  return (
    <span
      role="status"
      aria-label={`Save status: ${labels[shown]}`}
      title={error ?? undefined}
      data-status={shown}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${color}`}
    >
      {icon}
      <span className="hidden sm:inline">{labels[shown]}</span>
    </span>
  )
}

/** Bottom status bar: vim mode. */
export function StatusBar() {
  const mode = useUi((s) => s.vimMode)
  if (!mode) return null
  return (
    <footer className="flex h-6 shrink-0 items-center border-t border-neutral-200 bg-neutral-50 px-3 font-mono text-xs text-neutral-600">
      <span data-testid="vim-mode" className="font-semibold uppercase">
        -- {mode} --
      </span>
    </footer>
  )
}

/** Transient notifications (conflicts, errors). */
export function Notices() {
  const notices = useRepo((s) => s.notices)
  if (!notices.length) return null
  return (
    <div
      className="pointer-events-none fixed right-3 bottom-8 z-50 flex max-w-sm flex-col gap-2"
      aria-live="polite"
    >
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2 rounded border p-2.5 text-sm shadow-md ${
            n.kind === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-neutral-200 bg-white'
          }`}
        >
          <p className="flex-1">{n.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissNotice(n.id)}
            className="rounded p-0.5 hover:bg-black/5"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
