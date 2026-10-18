import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import { useUi } from '../store/ui.ts'
import { setupFakeDrive } from '../test/msw.ts'
import { getEditorView, renderApp } from '../test/renderApp.tsx'

setupFakeDrive({
  files: {
    'Work/Roadmap.md':
      '# Roadmap\n\nShip the <span style="color: green">quarterly</span> milestones.\n\nRun `npm ci` first.',
    'Home/Groceries.md': 'Milk, eggs and a roadmap poster.',
    'Ideas.md': 'Random thoughts',
  },
})

beforeEach(() => useUi.setState({ expanded: {}, quickOpen: false }))

const options = () => within(screen.getByRole('listbox', { name: 'Results' })).queryAllByRole('option')
const names = () => options().map((o) => o.querySelector('.font-medium')!.textContent)

async function openPalette() {
  await screen.findByRole('link', { name: 'Ideas' })
  await userEvent.keyboard('{Control>}k{/Control}')
  return screen.findByRole('combobox', { name: 'Search notes' })
}

describe('quick open', () => {
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

  it('matches part of a name anywhere, not just the start, and highlights it', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'OADM')
    expect(names()).toEqual(['Roadmap'])
    expect(options()[0]!.querySelector('mark')).toHaveTextContent(/^oadm$/)
  })

  it('matches letters in order with gaps (fuzzy)', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'grcr')
    expect(names()).toEqual(['Groceries'])
    expect([...options()[0]!.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Gr', 'c', 'r'])
  })

  it('finds folders, ranked above notes that only match by their folder', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'ork')
    expect(names()).toEqual(['Work', 'Roadmap'])
    expect(options()[0]).toHaveAttribute('data-kind', 'folder')
  })

  it('combines terms across the folder path and name', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'wo road')
    expect(names()).toEqual(['Roadmap'])
  })

  it('does not search note contents', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'milk')
    expect(await screen.findByText('Nothing matches “milk”.')).toBeInTheDocument()
  })

  it('navigates with the keyboard and opens the chosen note', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'o')
    expect(names().length).toBeGreaterThan(1)
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}')
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options()[1]!.id)
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(options()[options().length - 1]).toHaveAttribute('aria-selected', 'true') // wraps
    await userEvent.clear(input)
    await userEvent.type(input, 'dea{Enter}')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await waitFor(() => expect(getEditorView().state.doc.toString()).toBe('Random thoughts'))
  })

  it('choosing a folder expands it in the sidebar and focuses it', async () => {
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'ome{Enter}')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Notes' })
    expect(await within(nav).findByRole('link', { name: 'Groceries' })).toBeInTheDocument()
    await waitFor(() => expect(within(nav).getByRole('button', { name: /^Home/ })).toHaveFocus())
  })
})

describe('quick open preview', () => {
  const realMatchMedia = window.matchMedia
  const wide = (on: boolean) => {
    window.matchMedia = ((query: string) => ({
      ...realMatchMedia(query),
      matches: on && query.includes('min-width'),
    })) as typeof window.matchMedia
  }
  afterEach(() => {
    window.matchMedia = realMatchMedia
  })
  const preview = () => screen.getByRole('region', { name: 'Preview' })

  it('shows the focused note’s content beside the list and follows the selection', async () => {
    wide(true)
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'roadmap')
    await waitFor(() => expect(preview()).toHaveTextContent('Ship the quarterly milestones.'))
    // Rendered like the editor's live preview, read-only: color tags hidden, styles applied.
    const view = preview().querySelector('.cm-content')!
    expect(view).toHaveAttribute('aria-label', 'Note preview')
    expect(view).toHaveAttribute('contenteditable', 'false')
    expect(preview()).not.toHaveTextContent('<span')
    expect(preview().querySelector('.cm-color-green')).toHaveTextContent('quarterly')
    expect(preview()).not.toHaveTextContent('# Roadmap') // heading marks hidden
    expect(input).toHaveFocus()
    await userEvent.clear(input)
    await userEvent.type(input, 'groc')
    await waitFor(() => expect(preview()).toHaveTextContent('Milk, eggs and a roadmap poster.'))
    // Arrow keys move the preview along with the selection
    await userEvent.clear(input)
    await waitFor(() => expect(preview()).toHaveTextContent('Milk, eggs')) // empty query: Groceries first
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(preview()).toHaveTextContent('Random thoughts'))
  })

  it('lists a folder’s contents', async () => {
    wide(true)
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'work')
    expect(options()[0]).toHaveAttribute('data-kind', 'folder')
    expect(within(preview()).getByRole('list', { name: 'Contents of Work' })).toHaveTextContent('Roadmap')
  })

  it('is hidden on narrow screens', async () => {
    wide(false)
    renderApp('/')
    const input = await openPalette()
    await userEvent.type(input, 'roadmap')
    expect(names()).toEqual(['Roadmap'])
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()
  })
})

describe('content search (grep)', () => {
  const realMatchMedia = window.matchMedia
  afterEach(() => {
    window.matchMedia = realMatchMedia
  })
  const lines = () => options().map((o) => within(o).getByTestId('line').textContent)

  async function openGrep() {
    await screen.findByRole('link', { name: 'Ideas' })
    await userEvent.keyboard('{Control>}g{/Control}')
    return screen.findByRole('combobox', { name: 'Search note contents' })
  }

  it('opens with Ctrl+G and lists matching lines from all pages', async () => {
    renderApp('/')
    const input = await openGrep()
    expect(input).toHaveFocus()
    await userEvent.type(input, 'roadmap')
    // Contents become searchable once the background download has cached them.
    await waitFor(() => expect(options()).toHaveLength(2), { timeout: 4000 })
    expect(lines()).toEqual(['Milk, eggs and a roadmap poster.', '# Roadmap'])
    expect(options()[0]).toHaveTextContent('Groceries:1')
    expect(options()[0]!.querySelector('mark')).toHaveTextContent('roadmap')
    expect(screen.getByTestId('grep-status')).toHaveTextContent('2 lines')
  })

  it('is case-sensitive when the query has capitals, and ignores color tags', async () => {
    renderApp('/')
    const input = await openGrep()
    await userEvent.type(input, 'Roadmap')
    await waitFor(() => expect(lines()).toEqual(['# Roadmap']), { timeout: 4000 })
    await userEvent.clear(input)
    await userEvent.type(input, 'color')
    expect(await screen.findByText('No page contains “color”.')).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, 'quarterly')
    expect(lines()).toEqual(['Ship the quarterly milestones.'])
  })

  it('opens the page with the match selected', async () => {
    renderApp('/')
    const input = await openGrep()
    await userEvent.type(input, 'poster')
    await waitFor(() => expect(options()).toHaveLength(1), { timeout: 4000 })
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await waitFor(() => expect(getEditorView().state.doc.toString()).toContain('roadmap poster'))
    await waitFor(() => {
      const sel = getEditorView().state.selection.main
      expect(getEditorView().state.sliceDoc(sel.from, sel.to)).toBe('poster')
    })
  })

  it('previews the page with the match selected', async () => {
    window.matchMedia = ((query: string) => ({
      ...realMatchMedia(query),
      matches: query.includes('min-width'),
    })) as typeof window.matchMedia
    renderApp('/')
    const input = await openGrep()
    await userEvent.type(input, 'npm ci')
    await waitFor(() => expect(options()).toHaveLength(1), { timeout: 4000 })
    const preview = screen.getByRole('region', { name: 'Preview' })
    await waitFor(() => {
      const view = EditorView.findFromDOM(preview.querySelector('.cm-editor') as HTMLElement)!
      const sel = view.state.selection.main
      expect(view.state.sliceDoc(sel.from, sel.to)).toBe('npm ci')
    })
    expect(preview.querySelector('.cm-search-hit')).toHaveTextContent('npm ci')
    expect(input).toHaveFocus()
  })

  it('switches between names and contents with Ctrl+K / Ctrl+G, keeping the query', async () => {
    renderApp('/')
    const input = await openGrep()
    await userEvent.type(input, 'ideas')
    await userEvent.keyboard('{Control>}k{/Control}')
    const names = screen.getByRole('combobox', { name: 'Search notes' })
    expect(names).toHaveValue('ideas')
    expect(options()[0]).toHaveTextContent('Ideas')
    await userEvent.click(screen.getByRole('button', { name: 'Contents' }))
    expect(screen.getByRole('combobox', { name: 'Search note contents' })).toHaveFocus()
    await userEvent.keyboard('{Control>}g{/Control}') // same mode again: close
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('opens with \\fg outside text fields', async () => {
    renderApp('/')
    await screen.findByRole('link', { name: 'Ideas' })
    await userEvent.keyboard('\\fg')
    expect(await screen.findByRole('combobox', { name: 'Search note contents' })).toBeInTheDocument()
  })
})
