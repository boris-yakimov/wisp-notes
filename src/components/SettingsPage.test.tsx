import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getCache } from '../cache/instance.ts'
import { getAuth } from '../drive/auth.ts'
import { DriveClient } from '../drive/client.ts'
import { defaultSettings, loadSettings } from '../settings/settings.ts'
import { useApp } from '../store/app.ts'
import { installFakeGis, storeToken } from '../test/fakeGis.ts'
import { setupFakeDrive } from '../test/msw.ts'
import { DialogHost } from './DialogHost.tsx'
import { SettingsPage } from './SettingsPage.tsx'

const fake = setupFakeDrive({ noRoot: true })

const renderPage = (onConnected = vi.fn()) =>
  render(
    <>
      <SettingsPage onConnected={onConnected} />
      <DialogHost />
    </>,
  )

describe('SettingsPage', () => {
  beforeEach(() => useApp.setState({ settings: { ...defaultSettings } }))

  it('signs in, creates the Wisp Notes folder and persists the account', async () => {
    installFakeGis()
    const onConnected = vi.fn()
    renderPage(onConnected)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await vi.waitFor(() => expect(onConnected).toHaveBeenCalled())
    expect(loadSettings().account).toEqual({ email: 'me@example.com', name: 'Me' })
    expect(fake.drive.rootId).not.toBeNull()
    expect(screen.getByText('Signed in as me@example.com')).toBeInTheDocument()
  })

  it('does nothing when the popup is closed', async () => {
    installFakeGis({ cancel: true })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(loadSettings().account).toBeNull()
  })

  it('shows a clear error when Drive access is not granted', async () => {
    installFakeGis({ denyScope: true })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Google Drive access was not granted')
  })

  it('signs out after confirmation and clears local data', async () => {
    const gis = installFakeGis()
    storeToken('good-token') // valid for the fake Drive (the page looks up the notes folder)
    useApp.getState().updateSettings({ account: { email: 'me@example.com', name: 'Me' } })
    const cache = await getCache()
    await cache.putBlob('h', 'secret')
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sign out' }))
    await vi.waitFor(() => expect(loadSettings().account).toBeNull())
    expect(gis.revoked).toEqual(['good-token'])
    expect(await cache.getBlob('h')).toBeUndefined()
  })

  it('toggles and persists editor preferences', async () => {
    installFakeGis()
    renderPage()
    await userEvent.click(screen.getByLabelText('Vim mode'))
    expect(loadSettings().vim).toBe(false)
  })

  it('shows where the notes folder really is, with a link to it', async () => {
    installFakeGis()
    storeToken()
    useApp.getState().updateSettings({ account: { email: 'me@example.com', name: 'Me' } })
    await new DriveClient(getAuth()).ensureRoot()
    renderPage()
    expect(await screen.findByTestId('notes-folder')).toHaveTextContent('My Drive › Wisp Notes')
    expect(screen.getByRole('link', { name: /Open in Google Drive/ })).toHaveAttribute(
      'href',
      `https://drive.google.com/drive/folders/${fake.drive.rootId}`,
    )
  })

  it('shows "…" for moved-into folders the app cannot see', async () => {
    installFakeGis()
    storeToken()
    useApp.getState().updateSettings({ account: { email: 'me@example.com', name: 'Me' } })
    await new DriveClient(getAuth()).ensureRoot()
    fake.drive.relocateRoot(['Personal'], 'Notes')
    renderPage()
    expect(await screen.findByTestId('notes-folder')).toHaveTextContent(/^… › Notes$/)
    expect(screen.getByText(/can only see folders it created/)).toBeInTheDocument()
  })
})
