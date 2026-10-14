import { CheckCircle2, ExternalLink, Loader2, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getCache } from '../cache/instance.ts'
import { getAuth, GOOGLE_CLIENT_ID } from '../drive/auth.ts'
import { DriveClient } from '../drive/client.ts'
import { toDriveError } from '../drive/errors.ts'
import { useRepo } from '../repo/session.ts'
import { confirmDialog } from '../store/dialog.ts'
import { THEMES, type Theme } from '../settings/settings.ts'
import { useApp } from '../store/app.ts'

interface Props {
  /** Called after a successful sign-in. */
  onConnected?: () => void
}

type Status = { state: 'idle' } | { state: 'busy' } | { state: 'error'; message: string }

const primaryBtn =
  'inline-flex items-center gap-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60'

export function SettingsPage({ onConnected }: Props) {
  const account = useApp((s) => s.settings.account)
  const updateSettings = useApp((s) => s.updateSettings)
  const [status, setStatus] = useState<Status>({ state: 'idle' })

  useEffect(() => {
    if (GOOGLE_CLIENT_ID)
      void getAuth()
        .preload()
        .catch(() => undefined)
  }, [])

  async function signIn() {
    setStatus({ state: 'busy' })
    try {
      const auth = getAuth()
      await auth.signIn(account?.email)
      const client = new DriveClient(auth)
      const [me] = await Promise.all([client.about(), client.ensureRoot()])
      updateSettings({ account: me })
      setStatus({ state: 'idle' })
      onConnected?.()
    } catch (e) {
      const err = toDriveError(e)
      setStatus(err.kind === 'cancelled' ? { state: 'idle' } : { state: 'error', message: err.message })
    }
  }

  async function signOut() {
    const unsaved = Object.keys(useRepo.getState().dirty).length
    const ok = await confirmDialog({
      title: 'Sign out?',
      message: unsaved
        ? `${unsaved} note${unsaved === 1 ? ' has' : 's have'} unsaved changes that will be lost. Notes stored on this device are removed; your notes in Google Drive are not affected.`
        : 'Notes stored on this device are removed. Your notes in Google Drive are not affected.',
      confirmLabel: 'Sign out',
      danger: unsaved > 0,
    })
    if (!ok) return
    getAuth().signOut()
    await (await getCache()).clearAll()
    updateSettings({ account: null })
  }

  return (
    <div className="mx-auto max-w-md p-6">
      {account ? (
        <>
          <h2 className="mb-1 text-lg font-semibold">Google Drive</h2>
          <p className="mb-3 flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 size={16} /> Signed in as {account.email}
          </p>
          <NotesFolder email={account.email} />
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <LogOut size={14} /> Sign out
          </button>
        </>
      ) : (
        <>
          <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            Wisp Notes stores your notes in a “Wisp Notes” folder in your Google Drive (you can move or rename
            it later). It can only access files it created itself.
          </p>
          {GOOGLE_CLIENT_ID ? (
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={status.state === 'busy'}
              className={primaryBtn}
            >
              {status.state === 'busy' && <Loader2 size={14} className="animate-spin" />}
              Sign in with Google
            </button>
          ) : (
            <p
              role="alert"
              className="rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-2 text-sm text-red-800 dark:text-red-300"
            >
              No Google client ID is configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> in{' '}
              <code>.env.local</code> (see README) and restart the app.
            </p>
          )}
        </>
      )}
      {status.state === 'error' && (
        <p
          role="alert"
          className="mt-4 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-2 text-sm text-red-800 dark:text-red-300"
        >
          {status.message}
        </p>
      )}
      <Preferences />
    </div>
  )
}

function Preferences() {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  return (
    <>
      <fieldset className="mt-8 space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <legend className="sr-only">Appearance</legend>
        <h3 className="text-sm font-semibold">Appearance</h3>
        <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-x-4 gap-y-1">
          {THEMES.map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="theme"
                value={t}
                checked={settings.theme === t}
                onChange={() => updateSettings({ theme: t })}
              />
              {themeLabels[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-6 space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <legend className="sr-only">Editor preferences</legend>
        <h3 className="text-sm font-semibold">Editor</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.vim}
            onChange={(e) => updateSettings({ vim: e.target.checked })}
          />
          Vim mode
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.livePreview}
            onChange={(e) => updateSettings({ livePreview: e.target.checked })}
          />
          Live preview (hide Markdown syntax outside the current line)
        </label>
      </fieldset>
    </>
  )
}

const themeLabels: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  synthwave: 'Synthwave',
  terminal: 'Terminal',
}

type FolderInfo = { id: string; names: string[]; complete: boolean }

/** Where the notes folder really is in Drive (the user may have moved or renamed it). */
function NotesFolder({ email }: { email: string }) {
  const [folder, setFolder] = useState<FolderInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    const client = new DriveClient(getAuth())
    void (async () => {
      const id = await client.findRoot()
      if (!id) return
      const path = await client.folderPath(id)
      if (!cancelled) setFolder({ id, ...path })
    })().catch(() => undefined) // offline / sign-in expired: keep the generic text
    return () => {
      cancelled = true
    }
  }, [email])

  if (!folder) {
    return (
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Notes are stored in the app's folder in your Google Drive.
      </p>
    )
  }
  const shown = folder.complete ? folder.names : ['…', ...folder.names]
  return (
    <div className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
      <p>Notes are stored in this Google Drive folder:</p>
      <p className="my-1 font-medium text-neutral-900 dark:text-neutral-100" data-testid="notes-folder">
        {shown.join(' › ')}
      </p>
      {!folder.complete && (
        <p className="mb-1 text-xs">
          Wisp Notes can only see folders it created, so the folders above it are shown as “…”.
        </p>
      )}
      <a
        href={`https://drive.google.com/drive/folders/${encodeURIComponent(folder.id)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Open in Google Drive <ExternalLink size={12} aria-hidden />
      </a>
    </div>
  )
}
