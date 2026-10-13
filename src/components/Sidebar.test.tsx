import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { useRepo } from '../repo/session.ts'
import { useUi } from '../store/ui.ts'
import { Sidebar } from './Sidebar.tsx'

function setRepo(paths: string[], metas = {}) {
  useRepo.setState({
    phase: 'ready',
    snapshot: { entries: paths.map((path) => ({ path, id: path, folder: false, md5: path })) },
    metas,
    dirty: {},
  })
}

const renderSidebar = () =>
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )

describe('Sidebar', () => {
  beforeEach(() => useUi.setState({ expanded: {} }))

  it('shows folders first with icons, then notes', async () => {
    setRepo(['Zebra.md', 'Work/Plan.md', 'Work/_meta.json', 'Home/Food.md'], { Work: { icon: 'briefcase' } })
    renderSidebar()
    const items = within(screen.getByRole('tree')).getAllByRole('treeitem')
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['Home', 'Work', 'Zebra'])
    expect(items[0]!.querySelector('[data-icon]')!.getAttribute('data-icon')).toBe('folder')
    await vi.waitFor(() => expect(items[1]!.querySelector('svg[data-icon="briefcase"]')).not.toBeNull())
  })

  it('expands and collapses folders', async () => {
    setRepo(['Work/Plan.md', 'Work/Sub/Deep.md'])
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Plan' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Work' }))
    expect(screen.getByRole('treeitem', { name: 'Work' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/n/Work/Plan.md')
    expect(screen.getByRole('button', { name: 'Sub' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Work' }))
    expect(screen.queryByRole('link', { name: 'Plan' })).not.toBeInTheDocument()
  })

  it('encodes special characters in note links', () => {
    setRepo(['My Notes #1.md'])
    renderSidebar()
    expect(screen.getByRole('link', { name: 'My Notes #1' })).toHaveAttribute(
      'href',
      '/n/My%20Notes%20%231.md',
    )
  })

  it('marks notes with unsaved changes', () => {
    setRepo(['a.md'])
    useRepo.setState({ dirty: { 'a.md': true } })
    renderSidebar()
    expect(within(screen.getByRole('link', { name: 'a' })).getByTitle('Unsaved')).toBeInTheDocument()
  })

  it('shows an empty state', () => {
    setRepo(['README.txt'])
    renderSidebar()
    expect(screen.getByText('No notes yet.')).toBeInTheDocument()
  })
})
