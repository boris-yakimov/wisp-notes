import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useUi } from '../store/ui.ts'
import { AppShell } from './AppShell.tsx'

const renderShell = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('AppShell', () => {
  beforeEach(() => useUi.setState({ sidebarOpen: true }))

  it('renders title, sidebar and main pane', () => {
    renderShell(<AppShell sidebar={<p>tree</p>} main={<p>content</p>} />)
    expect(screen.getByRole('heading', { name: 'Wisp Notes' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Notes' })).toHaveTextContent('tree')
    expect(screen.getByRole('main')).toHaveTextContent('content')
  })

  it('collapses the sidebar', async () => {
    renderShell(<AppShell sidebar={<p>tree</p>} main={<p>content</p>} />)
    await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(screen.queryByRole('navigation', { name: 'Notes' })).not.toBeInTheDocument()
    expect(useUi.getState().sidebarOpen).toBe(false)
  })

  it('closes the drawer when the backdrop is tapped', async () => {
    renderShell(<AppShell sidebar={<p>tree</p>} main={<p>content</p>} />)
    await userEvent.click(screen.getByTestId('sidebar-backdrop'))
    expect(screen.queryByRole('navigation', { name: 'Notes' })).not.toBeInTheDocument()
  })

  it('hides the toggle when there is no sidebar', () => {
    renderShell(<AppShell sidebar={null} main={<p>content</p>} />)
    expect(screen.queryByRole('button', { name: 'Toggle sidebar' })).not.toBeInTheDocument()
  })
  it('links the title back to the main page', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="*" element={<AppShell sidebar={null} main={<p>settings</p>} />} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('link', { name: 'Wisp Notes' }))
    expect(screen.getByText('home page')).toBeInTheDocument()
  })
})
