import { CheckCircle2, Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { GitHubClient, validateConnection } from '../github/client.ts'
import { useApp } from '../store/app.ts'

interface Props {
  /** Called after a successful connection. */
  onConnected?: () => void
}

type Status =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; fullName: string }
  | { state: 'error'; message: string; canInit?: boolean }

const inputCls =
  'w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'

export function SettingsPage({ onConnected }: Props) {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const [form, setForm] = useState({
    token: settings.token,
    owner: settings.owner,
    repo: settings.repo,
    branch: settings.branch || 'main',
  })
  const [status, setStatus] = useState<Status>({ state: 'idle' })

  const field = (name: keyof typeof form) => ({
    id: `settings-${name}`,
    value: form[name],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [name]: e.target.value.trim() })),
  })

  async function connect(e?: FormEvent, init = false) {
    e?.preventDefault()
    if (!form.token || !form.owner || !form.repo || !form.branch) {
      setStatus({ state: 'error', message: 'All fields are required.' })
      return
    }
    setStatus({ state: 'checking' })
    const client = new GitHubClient(form)
    if (init) {
      try {
        await client.initializeEmptyRepo()
      } catch (err) {
        setStatus({ state: 'error', message: (err as Error).message })
        return
      }
    }
    const res = await validateConnection(client)
    if (res.ok) {
      updateSettings(form)
      setStatus({ state: 'ok', fullName: res.fullName })
      onConnected?.()
    } else {
      setStatus({ state: 'error', message: res.message, canInit: res.kind === 'empty-repo' })
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h2 className="mb-1 text-lg font-semibold">Connect to GitHub</h2>
      <p className="mb-4 text-sm text-neutral-600">
        Use a fine-grained personal access token limited to your notes repository with{' '}
        <strong>Contents: Read and write</strong> permission only. The token is stored only in this browser.
      </p>
      <form onSubmit={(e) => void connect(e)} className="space-y-3" noValidate>
        <div>
          <label htmlFor="settings-token" className="mb-1 block text-sm font-medium">
            Personal access token
          </label>
          <input {...field('token')} type="password" autoComplete="off" className={inputCls} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="settings-owner" className="mb-1 block text-sm font-medium">
              Owner
            </label>
            <input {...field('owner')} className={inputCls} placeholder="your-user" />
          </div>
          <div className="flex-1">
            <label htmlFor="settings-repo" className="mb-1 block text-sm font-medium">
              Repository
            </label>
            <input {...field('repo')} className={inputCls} placeholder="notes" />
          </div>
        </div>
        <div>
          <label htmlFor="settings-branch" className="mb-1 block text-sm font-medium">
            Branch
          </label>
          <input {...field('branch')} className={inputCls} />
        </div>
        <button
          type="submit"
          disabled={status.state === 'checking'}
          className="inline-flex items-center gap-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {status.state === 'checking' && <Loader2 size={14} className="animate-spin" />}
          Connect
        </button>
      </form>
      <div aria-live="polite" className="mt-4 text-sm">
        {status.state === 'ok' && (
          <p className="flex items-center gap-1.5 text-green-700">
            <CheckCircle2 size={16} /> Connected to {status.fullName}
          </p>
        )}
        {status.state === 'error' && (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-800">
            <p>{status.message}</p>
            {status.canInit && (
              <button
                type="button"
                onClick={() => void connect(undefined, true)}
                className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-xs hover:bg-red-100"
              >
                Initialize repository
              </button>
            )}
          </div>
        )}
      </div>
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
