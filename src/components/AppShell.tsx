import { PanelLeft } from 'lucide-react'
import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useUi } from '../store/ui.ts'

interface AppShellProps {
  sidebar: ReactNode
  main: ReactNode
  topBarRight?: ReactNode
  statusBar?: ReactNode
}

/**
 * Top bar + sidebar + main pane. On wide screens the sidebar is a collapsible column whose width
 * can be changed by dragging its right edge;
 * below the `md` breakpoint it becomes an overlay drawer with a backdrop.
 */
export function AppShell({ sidebar, main, topBarRight, statusBar }: AppShellProps) {
  const open = useUi((s) => s.sidebarOpen)
  const setOpen = useUi((s) => s.setSidebarOpen)
  const width = useUi((s) => s.sidebarWidth)
  const hasSidebar = sidebar !== null && sidebar !== undefined

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && window.matchMedia?.('(max-width: 767px)').matches) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 px-2">
        {hasSidebar && (
          <button
            type="button"
            aria-label="Toggle sidebar"
            aria-expanded={open}
            aria-controls="sidebar"
            onClick={() => setOpen(!open)}
            className="rounded p-1.5 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <PanelLeft size={18} />
          </button>
        )}
        <h1 className="truncate text-sm font-semibold tracking-tight">
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded px-1 hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {/* Same image as the favicon; decorative, the text names the link. */}
            <img src="/favicon.svg" alt="" width={18} height={18} className="shrink-0" />
            Wisp Notes
          </Link>
        </h1>
        <div className="ml-auto flex items-center gap-1">{topBarRight}</div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {hasSidebar && open && (
          <>
            <div
              className="absolute inset-0 z-30 bg-black/30 md:hidden"
              aria-hidden
              data-testid="sidebar-backdrop"
              onClick={() => setOpen(false)}
            />
            <nav
              id="sidebar"
              aria-label="Notes"
              style={{ '--sidebar-w': `${width}px` } as CSSProperties}
              className="absolute inset-y-0 left-0 z-40 w-[82vw] max-w-xs overflow-hidden border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/60 shadow-xl md:static md:z-auto md:w-(--sidebar-w) md:max-w-none md:shrink-0 md:shadow-none"
            >
              {sidebar}
            </nav>
            <ResizeHandle width={width} />
          </>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">{main}</main>
      </div>
      {statusBar}
    </div>
  )
}

/**
 * Drag to resize the sidebar (wide screens only). Also a keyboard-focusable separator: arrow keys
 * change the width, Home/End jump to the limits; double-click resets it.
 */
function ResizeHandle({ width }: { width: number }) {
  const setWidth = useUi((s) => s.setSidebarWidth)
  const drag = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, width }
    document.body.classList.add('resizing-sidebar')
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setWidth(drag.current.width + e.clientX - drag.current.x, false)
  }
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setWidth(drag.current.width + e.clientX - drag.current.x)
    drag.current = null
    document.body.classList.remove('resizing-sidebar')
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls="sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT_WIDTH)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16
        const next =
          e.key === 'ArrowLeft'
            ? width - step
            : e.key === 'ArrowRight'
              ? width + step
              : e.key === 'Home'
                ? SIDEBAR_MIN_WIDTH
                : e.key === 'End'
                  ? SIDEBAR_MAX_WIDTH
                  : null
        if (next === null) return
        e.preventDefault()
        setWidth(next)
      }}
      className="relative z-10 -ml-1 hidden w-2 shrink-0 cursor-col-resize touch-none md:block after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors hover:after:bg-indigo-400 focus-visible:outline-none focus-visible:after:bg-indigo-500 active:after:bg-indigo-500"
    />
  )
}
