import { act, screen, waitFor, within } from '@testing-library/react'
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

describe('App: Ctrl+click links', () => {
  function ctrlClick(text: string) {
    const view = getEditorView()
    view.posAtCoords = () => view.state.doc.toString().indexOf(text) + 1
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }),
    )
  }

  it('opens linked notes in the app and external links in a new tab', async () => {
    fake.drive.write('Work/Links.md', 'To [inbox](../Inbox.md) or [site](https://example.com)')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderApp('/n/Work/Links.md')
    await waitFor(() => expect(editorText()).toContain('[inbox]'))
    ctrlClick('site')
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    ctrlClick('inbox')
    await waitFor(() => expect(editorText()).toBe('# Inbox\n\nCafé ☕ and 🎉'))
    open.mockRestore()
  })
})

describe('App: sub-pages', () => {
  it("lists a note's sub-pages above the editor and opens them", async () => {
    fake.drive.write('Work/Plan/Tasks.md', 'Do things')
    fake.drive.write('Work/Plan/Ideas.md', 'Think')
    fake.drive.write('Work/Plan/Tasks/Today.md', 'Grandchild')
    renderApp('/n/Work/Plan.md')
    const subs = await screen.findByRole('navigation', { name: 'Sub-pages' })
    expect(subs).toHaveTextContent('2 sub-pages:')
    const links = within(subs).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Ideas', 'Tasks']) // direct children only
    await userEvent.click(within(subs).getByRole('link', { name: 'Tasks' }))
    await waitFor(() => expect(editorText()).toBe('Do things'))
    // Tasks has its own sub-page
    expect(await screen.findByRole('navigation', { name: 'Sub-pages' })).toHaveTextContent('Today')
  })

  it('shows nothing for notes without sub-pages', async () => {
    renderApp('/n/Inbox.md')
    await waitFor(() => expect(editorText()).toContain('Inbox'))
    expect(screen.queryByRole('navigation', { name: 'Sub-pages' })).not.toBeInTheDocument()
  })
})

describe('App: paste an image', () => {
  it('inserts the image into the note and uploads it next to the note', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pasted')
    renderApp('/n/Work/Plan.md')
    await waitFor(() => expect(editorText()).toBe('The plan'))
    const view = getEditorView()
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }))
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', { value: { files: [image], getData: () => '' } })
    act(() => void view.contentDOM.dispatchEvent(paste))
    expect(paste.defaultPrevented).toBe(true)
    expect(editorText()).toMatch(/^The plan\n!\[\]\(Plan\/Pasted%20image%20\d{4}-\d\d-\d\d%20\d{6}\.png\)$/)
    await waitFor(() =>
      expect(Object.keys(fake.drive.files()).some((p) => /^Work\/Plan\/Pasted image .*\.png$/.test(p))).toBe(
        true,
      ),
    )
    await waitFor(() => expect(document.querySelector('.cm-image img')).toHaveAttribute('src', 'blob:pasted'))
    created.mockRestore()
  })
})

describe('App: reopening a note', () => {
  it('returns to where you were in the note', async () => {
    // Own note: earlier tests' background saves can still touch the shared ones.
    fake.drive.write('Reading.md', 'Reading list')
    renderApp('/n/Reading.md', { vim: false })
    await waitFor(() => expect(editorText()).toBe('Reading list'))
    act(() => getEditorView().dispatch({ selection: { anchor: 4, head: 8 } }))
    await userEvent.click(screen.getByRole('link', { name: 'Inbox' }))
    await waitFor(() => expect(editorText()).toContain('Café'))
    expect(getEditorView().state.selection.main.head).toBe(0) // never opened before: top
    await userEvent.click(screen.getByRole('link', { name: 'Reading' }))
    await waitFor(() => expect(editorText()).toBe('Reading list'))
    const sel = getEditorView().state.selection.main
    expect([sel.anchor, sel.head]).toEqual([4, 8])
  })

  it('saves the position when the tab is closed', async () => {
    renderApp('/n/Inbox.md', { vim: false })
    await waitFor(() => expect(editorText()).toContain('Café'))
    act(() => getEditorView().dispatch({ selection: { anchor: 3 } }))
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(localStorage.getItem('wisp-notes:positions')!)['Inbox.md']).toMatchObject({
      anchor: 3,
      head: 3,
    })
  })
})
