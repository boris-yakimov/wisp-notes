import { AlertCircle, Settings as SettingsIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router'
import { AppShell } from './components/AppShell.tsx'
import { NotePage } from './components/NotePage.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { Notices, SaveStatus, StatusBar } from './components/StatusBar.tsx'
import { SessionProvider } from './components/Workspace.tsx'
import type { RepoSession } from './repo/session.ts'
import { useRepo } from './repo/session.ts'
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
  const configured = useApp((s) => isConfigured(s.settings))
  const navigate = useNavigate()
  return (
    <Routes>
      <Route
        path="/settings"
        element={
          <AppShell
            sidebar={null}
            topBarRight={<SettingsLink />}
            main={<SettingsPage onConnected={() => setTimeout(() => navigate('/'), 600)} />}
          />
        }
      />
      <Route
        path="*"
        element={
          configured ? (
            <SessionProvider>{(s) => <Connected session={s} />}</SessionProvider>
          ) : (
            <Navigate to="/settings" replace />
          )
        }
      />
    </Routes>
  )
}

function Connected({ session }: { session: RepoSession }) {
  useGlobalShortcuts(session)
  return (
    <>
      <AppShell
        sidebar={<Sidebar />}
        topBarRight={
          <>
            <SaveStatus />
            <SettingsLink />
          </>
        }
        main={
          <Routes>
            <Route path="/n/*" element={<NotePage />} />
            <Route path="*" element={<Home />} />
          </Routes>
        }
        statusBar={<StatusBar />}
      />
      <Notices />
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])
}

function Home() {
  const phase = useRepo((s) => s.phase)
  const error = useRepo((s) => s.error)
  if (phase === 'error') {
    return (
      <div
        role="alert"
        className="m-8 flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      >
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div>
          <p>{error}</p>
          <Link to="/settings" className="underline">
            Check settings
          </Link>
        </div>
      </div>
    )
  }
  return <div className="p-8 text-neutral-500">Select a note from the sidebar.</div>
}
