import { PanelLeft } from 'lucide-react'
import { useState, type ReactNode } from 'react'

interface AppShellProps {
  sidebar: ReactNode
  main: ReactNode
  topBarRight?: ReactNode
  statusBar?: ReactNode
}

/** Top bar + collapsible sidebar + main pane. */
export function AppShell({ sidebar, main, topBarRight, statusBar }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200 px-2">
        <button
          type="button"
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((o) => !o)}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100"
        >
          <PanelLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold tracking-tight">Wisp Notes</h1>
        <div className="ml-auto flex items-center gap-1">{topBarRight}</div>
      </header>
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <nav
            aria-label="Notes"
            className="w-64 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50"
          >
            {sidebar}
          </nav>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">{main}</main>
      </div>
      {statusBar}
    </div>
  )
}
