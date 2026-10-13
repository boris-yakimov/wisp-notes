import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useUi } from '../store/ui.ts'
import { setupFakeDrive } from '../test/msw.ts'
import { getEditorView, renderApp, typeInEditor } from '../test/renderApp.tsx'
import { filterIcons } from './iconSearch.ts'

const fake = setupFakeDrive({
  files: {
    'Inbox.md': 'inbox',
    'Work/Plan.md': 'plan',
    'Work/Sub/Deep.md': 'deep',
    'Work/_meta.json': '{}',
  },
})

beforeEach(() => useUi.setState({ expanded: { Work: true } }))

async function openMenu(name: string, role: 'link' | 'button' = 'link') {
  const el = await screen.findByRole(role, { name: new RegExp(`^${name}`) })
  fireEvent.contextMenu(el, { clientX: 10, clientY: 10 })
  return screen.getByRole('menu')
}

async function answerPrompt(value: string, button: string) {
  const dialog = await screen.findByRole('dialog')
  const input = within(dialog).getByRole('textbox')
  await userEvent.clear(input)
  await userEvent.type(input, value)
  await userEvent.click(within(dialog).getByRole('button', { name: button }))
}

describe('note & folder operations (T10)', () => {
  it('creates a note in one commit and opens it', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'New note' }))
    await answerPrompt('Ideas', 'Create')
    expect(await screen.findByRole('link', { name: /^Ideas/ })).toBeInTheDocument()
    await waitFor(() => expect(fake.drive.files()['Ideas.md']).toBe(''))
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull())
  })

  it('a new note can be edited right away without creating a conflict copy', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'New note' }))
    await answerPrompt('Fresh', 'Create')
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull())
    act(() => typeInEditor('hello'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    await waitFor(() => expect(fake.drive.files()['Fresh.md']).toBe('hello'))
    expect(Object.keys(fake.drive.files()).some((p) => p.includes('conflict'))).toBe(false)
  })

  it('creates a folder with a _meta.json placeholder', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }))
    await answerPrompt('Recipes', 'Create')
    expect(await screen.findByRole('treeitem', { name: 'Recipes' })).toBeInTheDocument()
    await waitFor(() => expect(fake.drive.folders()).toContain('Recipes'))
  })

  it('rejects duplicate names with a clear message', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'New note' }))
    await answerPrompt('Inbox', 'Create')
    expect(await screen.findByRole('alert')).toHaveTextContent('A note named "Inbox.md" already exists here.')
  })

  it('renames the open note via the context menu and follows it', async () => {
    renderApp('/n/Inbox.md')
    await waitFor(() => expect(getEditorView().state.doc.toString()).toBe('inbox'))
    const menu = await openMenu('Inbox')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    await answerPrompt('Today', 'Rename')
    await waitFor(() => expect(fake.drive.files()['Today.md']).toBe('inbox'))
    expect(fake.drive.files()['Inbox.md']).toBeUndefined()
    expect(await screen.findByRole('link', { name: /^Today/ })).toHaveAttribute('aria-current', 'page')
  })

  it('renames a folder with all its contents in one request', async () => {
    renderApp('/')
    const menu = await openMenu('Work', 'button')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    const before = fake.drive.writeCount()
    await answerPrompt('Job', 'Rename')
    await waitFor(() =>
      expect(Object.keys(fake.drive.files()).sort()).toEqual([
        'Inbox.md',
        'Job/Plan.md',
        'Job/Sub/Deep.md',
        'Job/_meta.json',
      ]),
    )
    expect(fake.drive.writeCount() - before).toBe(1)
    expect(screen.getByRole('treeitem', { name: 'Job' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('imports a picked folder into the clicked folder', async () => {
    const file = (name: string, rel: string, content: string) => {
      const f = new File([content], name)
      Object.defineProperty(f, 'webkitRelativePath', { value: rel })
      return f
    }
    const picked = [file('a.md', 'Export/a.md', '# A'), file('shot.png', 'Export/img/shot.png', 'PNG')]
    const opened: HTMLInputElement[] = []
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      opened.push(this)
      Object.defineProperty(this, 'files', { value: picked })
      void this.onchange?.(new Event('change'))
    })
    renderApp('/')
    const menu = await openMenu('Work', 'button')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Import folder…' }))
    expect(opened[0]!.webkitdirectory).toBe(true)
    await waitFor(() => expect(fake.drive.files()['Work/Export/a.md']).toBe('# A'))
    expect(fake.drive.files()['Work/Export/img/shot.png']).toBe('PNG')
    expect(await screen.findByText('Imported 2 files.')).toBeInTheDocument()
  })

  it('asks for confirmation before deleting', async () => {
    renderApp('/')
    let menu = await openMenu('Plan')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(fake.drive.files()['Work/Plan.md']).toBe('plan')

    menu = await openMenu('Plan')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fake.drive.files()['Work/Plan.md']).toBeUndefined())
  })

  it('deletes a folder in one commit', async () => {
    renderApp('/')
    const menu = await openMenu('Work', 'button')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('the 2 notes inside')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(Object.keys(fake.drive.files())).toEqual(['Inbox.md']))
  })

  it('rolls back the optimistic update when the commit fails', async () => {
    renderApp('/')
    fake.drive.failNext = (m: string) =>
      m === 'PATCH' ? { status: 500, body: { error: { message: 'boom' } } } : undefined
    const menu = await openMenu('Inbox')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    await answerPrompt('Gone', 'Rename')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not rename')
    expect(screen.getByRole('link', { name: /^Inbox/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Gone/ })).not.toBeInTheDocument()
  })

  it('supports keyboard navigation in the context menu', async () => {
    renderApp('/')
    const menu = await openMenu('Work', 'button')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      'New note',
      'New folder',
      'Import files…',
      'Import folder…',
      'Rename',
      'Move to…',
      'Change icon',
      'Delete',
    ])
    expect(items[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(items[7]).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('folder icon picker (T11)', () => {
  it('ranks icon search results', () => {
    const names = ['book', 'book-open', 'notebook', 'facebook', 'briefcase', 'house']
    expect(filterIcons(names, 'book')).toEqual(['book', 'book-open', 'facebook', 'notebook'])
    expect(filterIcons(names, 'book open')).toEqual(['book-open'])
    expect(filterIcons(names, 'zzz')).toEqual([])
    expect(filterIcons(names, '', 2)).toEqual(['book', 'book-open'])
  })

  it('picks an icon, writes _meta.json and updates the sidebar', async () => {
    renderApp('/')
    const menu = await openMenu('Work', 'button')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Change icon' }))
    const search = await screen.findByRole('searchbox', { name: 'Search icons' })
    await userEvent.type(search, 'briefcase')
    const options = within(screen.getByRole('listbox', { name: 'Icons' })).getAllByRole('option')
    expect(options[0]).toHaveAccessibleName('briefcase')
    expect(options.every((o) => o.getAttribute('aria-label')!.includes('briefcase'))).toBe(true)
    await userEvent.click(options[0]!)
    await waitFor(() => expect(fake.drive.files()['Work/_meta.json']).toBe('{\n  "icon": "briefcase"\n}\n'))
    await waitFor(() =>
      expect(
        screen.getByRole('treeitem', { name: 'Work' }).querySelector('svg[data-icon="briefcase"]'),
      ).not.toBeNull(),
    )
  })

  it('removes an icon', async () => {
    fake.drive.write('Work/_meta.json', '{"icon":"star"}')
    renderApp('/')
    const menu = await openMenu('Work', 'button')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Change icon' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove icon' }))
    await waitFor(() => expect(fake.drive.files()['Work/_meta.json']).toBe('{}\n'))
  })
})

describe('moving with drag and drop', () => {
  /** Simulate an HTML5 drag from one element to another. */
  function drag(from: Element, to: Element) {
    const data = new Map<string, string>()
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      effectAllowed: '',
      dropEffect: '',
    }
    fireEvent.dragStart(from, { dataTransfer })
    fireEvent.dragEnter(to, { dataTransfer })
    fireEvent.dragOver(to, { dataTransfer })
    fireEvent.drop(to, { dataTransfer })
    fireEvent.dragEnd(from, { dataTransfer })
  }

  it('moves a note into a folder', async () => {
    renderApp('/')
    drag(await screen.findByRole('link', { name: /^Inbox/ }), screen.getByRole('button', { name: /^Work/ }))
    await waitFor(() => expect(fake.drive.files()['Work/Inbox.md']).toBe('inbox'))
    expect(fake.drive.files()['Inbox.md']).toBeUndefined()
    expect(await screen.findByRole('link', { name: /^Inbox/ })).toHaveAttribute('href', '/n/Work/Inbox.md')
  })

  it('nests a folder inside another folder with its contents', async () => {
    fake.drive.mkdir('Archive')
    renderApp('/')
    drag(
      await screen.findByRole('button', { name: /^Work/ }),
      await screen.findByRole('button', { name: /^Archive/ }),
    )
    await waitFor(() => expect(fake.drive.files()['Archive/Work/Sub/Deep.md']).toBe('deep'))
    expect(fake.drive.folders()).toEqual(['Archive', 'Archive/Work', 'Archive/Work/Sub'])
  })

  it('moves to the top level when dropped on empty space, and follows the open note', async () => {
    renderApp('/n/Work/Plan.md')
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull())
    drag(screen.getByRole('link', { name: /^Plan/ }), screen.getByTestId('tree-root'))
    await waitFor(() => expect(fake.drive.files()['Plan.md']).toBe('plan'))
    expect(await screen.findByRole('link', { name: /^Plan/ })).toHaveAttribute('aria-current', 'page')
  })

  it('dropping on a note nests the item under it', async () => {
    renderApp('/')
    drag(await screen.findByRole('link', { name: /^Inbox/ }), screen.getByRole('link', { name: /^Plan/ }))
    await waitFor(() => expect(fake.drive.files()['Work/Plan/Inbox.md']).toBe('inbox'))
    expect(fake.drive.files()['Work/Plan.md']).toBe('plan')
    const plan = screen.getByRole('treeitem', { name: 'Plan' })
    expect(plan).toHaveAttribute('aria-expanded', 'true')
    expect(within(plan).getByRole('link', { name: /^Inbox/ })).toHaveAttribute(
      'href',
      '/n/Work/Plan/Inbox.md',
    )
  })

  it('ignores dropping a folder into itself', async () => {
    renderApp('/')
    const before = fake.drive.writeCount()
    drag(await screen.findByRole('button', { name: /^Work/ }), screen.getByRole('button', { name: /^Sub/ }))
    await new Promise((r) => setTimeout(r, 50))
    expect(fake.drive.writeCount()).toBe(before)
    expect(fake.drive.files()['Work/Plan.md']).toBe('plan')
  })

  it('reports a name clash instead of overwriting', async () => {
    fake.drive.write('Work/Inbox.md', 'other')
    renderApp('/')
    await screen.findAllByRole('link', { name: /^Inbox/ })
    drag(document.querySelector('a[href="/n/Inbox.md"]')!, screen.getByRole('button', { name: /^Work/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists in “Work”')
    expect(fake.drive.files()['Inbox.md']).toBe('inbox')
  })

  it('offers "Move to…" as a keyboard/touch alternative', async () => {
    renderApp('/')
    const menu = await openMenu('Inbox')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move to…' }))
    const dialog = await screen.findByRole('dialog')
    const list = within(dialog).getByRole('listbox')
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Work', 'Work / Plan', 'Work / Sub', 'Work / Sub / Deep'])
    await userEvent.type(within(dialog).getByRole('searchbox'), 'sub{Enter}')
    await waitFor(() => expect(fake.drive.files()['Work/Sub/Inbox.md']).toBe('inbox'))
  })
})

describe('sub-notes', () => {
  beforeEach(() => {
    fake.drive.write('Work/Plan/Step.md', 'step')
    fake.drive.write('Work/Plan/Step/Detail.md', 'detail')
  })

  it('shows a note with sub-notes as an expandable note, not a folder', async () => {
    renderApp('/')
    const plan = await screen.findByRole('treeitem', { name: 'Plan' })
    expect(screen.queryByRole('button', { name: /^Plan/ })).not.toBeInTheDocument() // no separate folder row
    expect(plan).toHaveAttribute('aria-expanded', 'false')
    expect(within(plan).getByRole('link', { name: /^Plan/ })).toHaveAttribute('href', '/n/Work/Plan.md')
    await userEvent.click(within(plan).getByRole('button', { name: 'Expand Plan' }))
    expect(plan).toHaveAttribute('aria-expanded', 'true')
    expect(within(plan).getByRole('link', { name: /^Step/ })).toHaveAttribute('href', '/n/Work/Plan/Step.md')
    expect(within(plan).getByRole('link', { name: /^Plan/ })).not.toHaveAttribute('aria-current') // didn't open it
  })

  it('creates a sub-note from the note row', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'New sub-note in Inbox' }))
    await answerPrompt('Today', 'Create')
    await waitFor(() => expect(fake.drive.files()['Inbox/Today.md']).toBe(''))
    expect(fake.drive.files()['Inbox.md']).toBe('inbox')
    const inbox = screen.getByRole('treeitem', { name: 'Inbox' })
    expect(within(inbox).getByRole('link', { name: /^Today/ })).toHaveAttribute('aria-current', 'page')
  })

  it('renames a note together with its sub-notes and follows the open sub-note', async () => {
    renderApp('/n/Work/Plan/Step.md')
    await waitFor(() => expect(getEditorView().state.doc.toString()).toBe('step'))
    const menu = await openMenu('Plan')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    await answerPrompt('Roadmap', 'Rename')
    await waitFor(() => expect(fake.drive.files()['Work/Roadmap/Step/Detail.md']).toBe('detail'))
    expect(fake.drive.files()['Work/Roadmap.md']).toBe('plan')
    expect(fake.drive.folders()).not.toContain('Work/Plan')
    await waitFor(() =>
      expect(document.querySelector('a[aria-current="page"]')).toHaveAttribute(
        'href',
        '/n/Work/Roadmap/Step.md',
      ),
    )
  })

  it('deletes a note with its sub-notes after confirming the count', async () => {
    renderApp('/')
    const menu = await openMenu('Plan')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('“Plan” and its 2 sub-notes will be deleted')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(Object.keys(fake.drive.files()).some((p) => p.startsWith('Work/Plan'))).toBe(false),
    )
  })

  it('moves a note with its sub-notes', async () => {
    renderApp('/')
    const menu = await openMenu('Plan')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move to…' }))
    const dialog = await screen.findByRole('dialog')
    const options = within(within(dialog).getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).not.toContain('Work / Plan / Step') // not under itself
    await userEvent.type(within(dialog).getByRole('searchbox'), 'inbox{Enter}')
    await waitFor(() => expect(fake.drive.files()['Inbox/Plan/Step/Detail.md']).toBe('detail'))
    expect(fake.drive.files()['Inbox/Plan.md']).toBe('plan')
  })
})
