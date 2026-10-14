import { PanelLeft } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useUi } from '../store/ui.ts'

interface AppShellProps {
  sidebar: ReactNode
  main: ReactNode
  topBarRight?: ReactNode
  statusBar?: ReactNode
}

/**
 * Top bar + sidebar + main pane. On wide screens the sidebar is a collapsible column;
 * below the `md` breakpoint it becomes an overlay drawer with a backdrop.
 */
export function AppShell({ sidebar, main, topBarRight, statusBar }: AppShellProps) {
  const open = useUi((s) => s.sidebarOpen)
  const setOpen = useUi((s) => s.setSidebarOpen)
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
        <h1 className="truncate text-sm font-semibold tracking-tight">Wisp Notes</h1>
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
              className="absolute inset-y-0 left-0 z-40 w-[82vw] max-w-xs overflow-hidden border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/60 shadow-xl md:static md:z-auto md:w-64 md:max-w-none md:shrink-0 md:shadow-none"
            >
              {sidebar}
            </nav>
          </>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">{main}</main>
      </div>
      {statusBar}
    </div>
  )
}
