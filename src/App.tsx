import { ArrowLeft, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router'
import { AppShell } from './components/AppShell.tsx'
import { Home } from './components/Home.tsx'
import { NotePage } from './components/NotePage.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import { NotesSidebar } from './components/NotesSidebar.tsx'
import { DialogHost } from './components/DialogHost.tsx'
import { QuickOpen } from './components/QuickOpen.tsx'
import { SearchService } from './search/service.ts'
import { useUi } from './store/ui.ts'
import { AuthBanner, ImportProgress, Notices, SaveStatus, StatusBar } from './components/StatusBar.tsx'
import { SessionProvider } from './components/Workspace.tsx'
import type { RepoSession } from './repo/session.ts'
import { isConfigured } from './settings/settings.ts'
import { useApp } from './store/app.ts'

const iconBtn = 'rounded p-1.5 text-neutral-600 hover:bg-neutral-100'

function SettingsLink() {
  return (
    <Link to="/settings" aria-label="Settings" className={iconBtn}>
      <SettingsIcon size={18} />
    </Link>
  )
}

export default function App() {
  const account = useApp((s) => s.settings.account)
  const configured = useApp((s) => isConfigured(s.settings))
  const navigate = useNavigate()
  return (
    <Routes>
      <Route
        path="/settings"
        element={
          <AppShell
            sidebar={null}
            topBarRight={
              configured ? (
                <Link to="/" aria-label="Back to notes" className={iconBtn}>
                  <ArrowLeft size={18} />
                </Link>
              ) : null
            }
            main={
              <>
                <SettingsPage onConnected={() => navigate('/')} />
                <DialogHost />
              </>
            }
          />
        }
      />
      <Route
        path="*"
        element={
          account ? (
            <SessionProvider key={account.email} account={account}>
              {(s) => <Connected session={s} />}
            </SessionProvider>
          ) : (
            <Navigate to="/settings" replace />
          )
        }
      />
    </Routes>
  )
}

function useSearchService(session: RepoSession): SearchService | null {
  const [search, setSearch] = useState<SearchService | null>(null)
  useEffect(() => {
    const s = new SearchService(session)
    setSearch(s) // eslint-disable-line react-hooks/set-state-in-effect -- owns an external resource
    return () => s.dispose()
  }, [session])
  return search
}

function Connected({ session }: { session: RepoSession }) {
  useGlobalShortcuts(session)
  const search = useSearchService(session)
  return (
    <>
      <AppShell
        sidebar={<NotesSidebar />}
        topBarRight={
          <>
            <SaveStatus />
            <SettingsLink />
          </>
        }
        main={
          <div className="flex h-full flex-col">
            <AuthBanner />
            <div className="min-h-0 flex-1">
              <Routes>
                <Route path="/n/*" element={<NotePage />} />
                <Route path="*" element={<Home />} />
              </Routes>
            </div>
          </div>
        }
        statusBar={<StatusBar />}
      />
      <Notices />
      <ImportProgress />
      <DialogHost />
      {search && <QuickOpen search={search} />}
    </>
  )
}

function useGlobalShortcuts(session: RepoSession) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void session.saver.saveNow()
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        const ui = useUi.getState()
        ui.setQuickOpen(!ui.quickOpen)
      }
    }
    // Capture phase: runs before the editor's keymaps (vim, emacs-style Ctrl+K).
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [session])
}
