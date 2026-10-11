import { Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<AppShell main={<EmptyState />} sidebar={null} />} />
    </Routes>
  )
}

function EmptyState() {
  return <div className="p-8 text-neutral-500">Select a note from the sidebar.</div>
}
