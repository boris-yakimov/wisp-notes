import { CheckCircle2, Loader2, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getCache } from '../cache/instance.ts'
import { getAuth, GOOGLE_CLIENT_ID } from '../drive/auth.ts'
import { DriveClient } from '../drive/client.ts'
import { toDriveError } from '../drive/errors.ts'
import { useRepo } from '../repo/session.ts'
import { confirmDialog } from '../store/dialog.ts'
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
          <p className="mb-3 flex items-center gap-1.5 text-sm text-green-700">
            <CheckCircle2 size={16} /> Signed in as {account.email}
          </p>
          <p className="mb-4 text-sm text-neutral-600">
            Notes are stored in the “Wisp Notes” folder in your Google Drive.
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            <LogOut size={14} /> Sign out
          </button>
        </>
      ) : (
        <>
          <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
          <p className="mb-4 text-sm text-neutral-600">
            Wisp Notes stores your notes in a “Wisp Notes” folder in your Google Drive. It can only access
            files it created itself.
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
            <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              No Google client ID is configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> in{' '}
              <code>.env.local</code> (see README) and restart the app.
            </p>
          )}
        </>
      )}
      {status.state === 'error' && (
        <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
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
    <fieldset className="mt-8 space-y-2 border-t border-neutral-200 pt-4">
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
  )
}
