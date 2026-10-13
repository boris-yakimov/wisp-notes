import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupFakeDrive } from './test/msw.ts'
import { getEditorView, pressKey, renderApp, typeInEditor } from './test/renderApp.tsx'
import { loadSettings } from './settings/settings.ts'
import { useUi } from './store/ui.ts'

const fake = setupFakeDrive({
  files: {
    'Inbox.md': '# Inbox\n\nCafé ☕ and 🎉',
    'Work/Plan.md': 'The plan',
    'Work/_meta.json': '{"icon":"briefcase"}',
  },
})

beforeEach(() => useUi.setState({ expanded: {}, vimMode: null }))

const editorText = () => getEditorView().state.doc.toString()

describe('App: open notes (T4)', () => {
  it('redirects to sign-in when signed out', async () => {
    renderApp('/', {}, { signedIn: false })
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('signs in with Google and shows the notes', async () => {
    renderApp('/', {}, { signedIn: false })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }))
    expect(await screen.findByRole('link', { name: 'Inbox' })).toBeInTheDocument()
    expect(loadSettings().account).toEqual({ email: 'me@example.com', name: 'Me' })
  })

  it('opens a note from the sidebar with UTF-8 content', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('link', { name: 'Inbox' }))
    await waitFor(() => expect(editorText()).toBe('# Inbox\n\nCafé ☕ and 🎉'))
  })

  it('loads a deep link directly and expands its folder', async () => {
    renderApp('/n/Work/Plan.md')
    await waitFor(() => expect(editorText()).toBe('The plan'))
    expect(screen.getByRole('treeitem', { name: 'Work' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows an error for a missing note', async () => {
    renderApp('/n/Nope.md')
    expect(await screen.findByRole('alert')).toHaveTextContent('This note does not exist.')
  })

  it('asks to continue when the Google sign-in expired, then loads', async () => {
    renderApp('/', {}, { token: false })
    const banner = await screen.findByText(/Google sign-in expired/)
    expect(banner).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue as me@example.com' }))
    expect(await screen.findByRole('link', { name: 'Inbox' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Google sign-in expired/)).not.toBeInTheDocument())
  })
})

describe('App: editing and saving (T6/T7)', () => {
  it('Ctrl+S saves the edit to Google Drive', async () => {
    renderApp('/n/Inbox.md', { vim: false })
    await waitFor(() => expect(editorText()).toContain('Café'))
    act(() => typeInEditor('\nmore'))
    expect(await screen.findByRole('status', { name: 'Save status: Unsaved' })).toBeInTheDocument()
    act(() => pressKey('s', { ctrlKey: true }))
    await waitFor(() => expect(fake.drive.files()['Inbox.md']).toBe('# Inbox\n\nCafé ☕ and 🎉\nmore'))
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Save status: Saved' })).toBeInTheDocument(),
    )
  })

  it('reloads the open note when it changes remotely and has no local edits', async () => {
    renderApp('/n/Work/Plan.md', { vim: false })
    await waitFor(() => expect(editorText()).toBe('The plan'))
    fake.drive.write('Work/Plan.md', 'The new plan')
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(editorText()).toBe('The new plan'))
  })
})

describe('App: vim mode (T8)', () => {
  it('shows the mode and switches between NORMAL and INSERT', async () => {
    renderApp('/n/Work/Plan.md')
    await waitFor(() => expect(editorText()).toBe('The plan'))
    expect(await screen.findByTestId('vim-mode')).toHaveTextContent('normal')
    act(() => pressKey('i'))
    expect(screen.getByTestId('vim-mode')).toHaveTextContent('insert')
    act(() => pressKey('Escape'))
    expect(screen.getByTestId('vim-mode')).toHaveTextContent('normal')
    act(() => pressKey('v'))
    expect(screen.getByTestId('vim-mode')).toHaveTextContent('visual')
  })

  it('dd deletes a line and :w saves', async () => {
    renderApp('/n/Inbox.md')
    await waitFor(() => expect(editorText()).toContain('Café'))
    act(() => {
      pressKey('d')
      pressKey('d')
    })
    expect(editorText()).toBe('\nCafé ☕ and 🎉')
    act(() => pressKey(':'))
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('.cm-vim-panel input')
      if (!el) throw new Error('no ex input')
      return el
    })
    input.value = 'w'
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
    })
    await waitFor(() => expect(fake.drive.files()['Inbox.md']).toBe('\nCafé ☕ and 🎉'))
  })

  it('can be turned off and the setting persists', async () => {
    renderApp('/n/Work/Plan.md', { vim: false })
    await waitFor(() => expect(editorText()).toBe('The plan'))
    expect(screen.queryByTestId('vim-mode')).not.toBeInTheDocument()
    expect(loadSettings().vim).toBe(false)
  })
})

describe('App: empty notes folder', () => {
  it('shows onboarding with create actions', async () => {
    for (const p of ['Inbox.md', 'Work/Plan.md', 'Work/_meta.json']) fake.drive.write(p, null)
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'No notes yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import a folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create a note' })).toBeInTheDocument()
  })
})
