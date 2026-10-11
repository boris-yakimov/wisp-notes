import { Settings as SettingsIcon } from 'lucide-react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router'
import { AppShell } from './components/AppShell.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import { isConfigured } from './settings/settings.ts'
import { useApp } from './store/app.ts'

export default function App() {
  const configured = useApp((s) => isConfigured(s.settings))
  const navigate = useNavigate()
  const topBarRight = (
    <Link
      to="/settings"
      aria-label="Settings"
      className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100"
    >
      <SettingsIcon size={18} />
    </Link>
  )
  return (
    <Routes>
      <Route
        path="/settings"
        element={
          <AppShell
            sidebar={null}
            topBarRight={topBarRight}
            main={<SettingsPage onConnected={() => setTimeout(() => navigate('/'), 600)} />}
          />
        }
      />
      <Route
        path="*"
        element={
          configured ? (
            <AppShell main={<EmptyState />} sidebar={null} topBarRight={topBarRight} />
          ) : (
            <Navigate to="/settings" replace />
          )
        }
      />
    </Routes>
  )
}

function EmptyState() {
  return <div className="p-8 text-neutral-500">Select a note from the sidebar.</div>
}
