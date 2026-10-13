import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRepo } from '../repo/session.ts'
import { useUi } from '../store/ui.ts'
import { setupFakeDrive } from '../test/msw.ts'
import { getEditorView, renderApp, typeInEditor } from '../test/renderApp.tsx'

const fake = setupFakeDrive({
  files: {
    'Work/Roadmap.md': '# Roadmap\n\nShip the quarterly milestones.',
    'Home/Groceries.md': 'Milk, eggs and a roadmap poster.',
    'Ideas.md': 'Random thoughts',
  },
})

beforeEach(() => useUi.setState({ expanded: {}, quickOpen: false }))

const options = () => within(screen.getByRole('listbox', { name: 'Results' })).queryAllByRole('option')

async function openPalette() {
  await screen.findByRole('link', { name: 'Ideas' })
  await userEvent.keyboard('{Control>}k{/Control}')
  return screen.findByRole('combobox', { name: 'Search notes' })
}

describe('quick open (T12)', () => {
  it('opens with Ctrl+K and lists all notes for an empty query', async () => {
    renderApp('/')
    const input = await openPalette()
    expect(input).toHaveFocus()
    expect(options().map((o) => o.textContent)).toEqual(['GroceriesHome', 'Ideas', 'RoadmapWork'])
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('opens from the sidebar search button', async () => {
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Notes' })
    await userEvent.click(within(nav).getByRole('button', { name: /^Search/ }))
    expect(screen.getByRole('combobox', { name: 'Search notes' })).toBeInTheDocument()
  })

  it('searches content after background prefetch, title matches first, with highlighting', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'roadmap')
    await waitFor(() => expect(options()).toHaveLength(2), { timeout: 4000 })
    expect(options()[0]).toHaveTextContent('Roadmap')
    expect(options()[0]!.querySelector('mark')).toHaveTextContent('Roadmap')
    expect(within(options()[1]!).getByTestId('snippet').querySelector('mark')).toHaveTextContent('roadmap')
  })

  it('navigates with the keyboard and opens the note with the match selected', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'milestones')
    await waitFor(() => expect(options()).toHaveLength(1), { timeout: 4000 })
    await userEvent.type(input, '{backspace}'.repeat(10) + 'roadmap')
    await waitFor(() => expect(options()).toHaveLength(2))
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}')
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options()[1]!.id)
    await userEvent.keyboard('{ArrowDown}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true') // wraps
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await waitFor(() => expect(getEditorView().state.doc.toString()).toContain('roadmap poster'))
    await waitFor(() => {
      const sel = getEditorView().state.selection.main
      expect(getEditorView().state.sliceDoc(sel.from, sel.to)).toBe('roadmap')
    })
  })

  it('updates the index incrementally when a note is edited', async () => {
    renderApp('/n/Ideas.md', { vim: false })
    await waitFor(() => expect(getEditorView().state.doc.toString()).toBe('Random thoughts'))
    act(() => typeInEditor(' about zeppelins'))
    await waitFor(() => expect(useRepo.getState().dirty['Ideas.md']).toBe(true))
    const input = await openPalette()
    await userEvent.type(input, 'zeppelin')
    await waitFor(() =>
      expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('Ideas')]),
    )
  })

  it('works offline from the cache', async () => {
    const first = renderApp('/')
    await openPalette()
    await userEvent.type(screen.getByRole('combobox'), 'milk')
    await waitFor(() => expect(options()).toHaveLength(1), { timeout: 4000 })
    first.unmount()

    fake.drive.offline = true
    useUi.setState({ quickOpen: false })
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'milk')
    await waitFor(() => expect(options()).toHaveLength(1))
    expect(options()[0]).toHaveTextContent('Groceries')
  })

  it('shows an empty state', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'qwertyuiop')
    expect(await screen.findByText('No notes match “qwertyuiop”.')).toBeInTheDocument()
  })
})
