import { AlertCircle, FilePlus, FolderPlus, Loader2, Search } from 'lucide-react'
import { Link } from 'react-router'
import { isNotePath } from '../repo/paths.ts'
import { useRepo } from '../repo/session.ts'
import { useUi } from '../store/ui.ts'
import { useTreeActions } from './useTreeActions.ts'

const btn =
  'inline-flex items-center gap-2 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50'

/** Main pane when no note is open: errors, empty-repo onboarding, or a hint. */
export function Home() {
  const phase = useRepo((s) => s.phase)
  const error = useRepo((s) => s.error)
  // A root README (e.g. created by "Initialize repository") doesn't count as a note here.
  const noteCount = useRepo(
    (s) =>
      s.snapshot?.entries.filter((e) => isNotePath(e.path) && e.path.toLowerCase() !== 'readme.md').length ??
      null,
  )
  const setQuickOpen = useUi((s) => s.setQuickOpen)
  const setSidebarOpen = useUi((s) => s.setSidebarOpen)
  const actions = useTreeActions()

  if (phase === 'error') {
    return (
      <div
        role="alert"
        className="m-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:m-8"
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
  if (noteCount === null) {
    return (
      <div role="status" className="flex items-center gap-2 p-8 text-sm text-neutral-500">
        <Loader2 size={16} className="animate-spin" /> Loading notes…
      </div>
    )
  }
  if (noteCount === 0) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h2 className="mb-1 text-lg font-semibold">Your notes repository is empty</h2>
        <p className="mb-5 text-sm text-neutral-600">
          Create your first note or a folder to organize notes by category. Everything is saved to GitHub
          automatically.
        </p>
        <div className="flex justify-center gap-2">
          <button type="button" className={btn} onClick={() => void actions.newNote('')}>
            <FilePlus size={16} /> Create a note
          </button>
          <button type="button" className={btn} onClick={() => void actions.newFolder('')}>
            <FolderPlus size={16} /> Create a folder
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-md p-8 text-center text-sm text-neutral-500">
      <p className="mb-4">Select a note from the sidebar, or search for one.</p>
      <div className="flex justify-center gap-2">
        <button type="button" className={btn} onClick={() => setQuickOpen(true)}>
          <Search size={16} /> Search notes
        </button>
        <button type="button" className={`${btn} md:hidden`} onClick={() => setSidebarOpen(true)}>
          Browse folders
        </button>
      </div>
    </div>
  )
}
