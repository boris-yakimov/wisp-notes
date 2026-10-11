import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from './SettingsPage.tsx'
import { useApp } from '../store/app.ts'
import { defaultSettings, loadSettings } from '../settings/settings.ts'
import { setupFakeGitHub } from '../test/msw.ts'

const fake = setupFakeGitHub({ files: { 'a.md': 'x' } })

async function fill(token: string, repo = 'notes') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Personal access token'), token)
  await user.type(screen.getByLabelText('Owner'), 'me')
  await user.type(screen.getByLabelText('Repository'), repo)
  await user.click(screen.getByRole('button', { name: 'Connect' }))
}

describe('SettingsPage', () => {
  beforeEach(() => useApp.setState({ settings: { ...defaultSettings } }))

  it('connects and persists settings', async () => {
    const onConnected = vi.fn()
    render(<SettingsPage onConnected={onConnected} />)
    await fill('good-token')
    expect(await screen.findByText('Connected to me/notes')).toBeInTheDocument()
    expect(onConnected).toHaveBeenCalled()
    expect(loadSettings()).toMatchObject({ token: 'good-token', owner: 'me', repo: 'notes', branch: 'main' })
  })

  it('shows a clear error for a bad token and does not persist', async () => {
    render(<SettingsPage />)
    await fill('bad')
    expect(await screen.findByRole('alert')).toHaveTextContent('The token is invalid or expired.')
    expect(loadSettings().token).toBe('')
  })

  it('shows an error for a missing repo', async () => {
    render(<SettingsPage />)
    await fill('good-token', 'other')
    expect(await screen.findByRole('alert')).toHaveTextContent('Repository or branch not found')
  })

  it('requires all fields', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(screen.getByRole('alert')).toHaveTextContent('All fields are required.')
  })

  it('offers to initialize an empty repository', async () => {
    fake.gh.refs.clear()
    render(<SettingsPage />)
    await fill('good-token')
    await userEvent.click(await screen.findByRole('button', { name: 'Initialize repository' }))
    expect(await screen.findByText('Connected to me/notes')).toBeInTheDocument()
    expect(fake.gh.files()['README.md']).toContain('Wisp Notes')
  })

  it('toggles and persists editor preferences', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByLabelText('Vim mode'))
    expect(loadSettings().vim).toBe(false)
  })
})
