import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useUi } from '../store/ui.ts'
import { AppShell } from './AppShell.tsx'

const renderShell = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('AppShell', () => {
  beforeEach(() => useUi.setState({ sidebarOpen: true, sidebarWidth: 256 }))

  it('resizes the sidebar by dragging its edge and remembers the width', () => {
    renderShell(<AppShell sidebar={<p>tree</p>} main={<p>content</p>} />)
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    handle.setPointerCapture = () => {}
    fireEvent.pointerDown(handle, { button: 0, clientX: 256, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 356, pointerId: 1 })
    expect(screen.getByRole('navigation', { name: 'Notes' }).style.getPropertyValue('--sidebar-w')).toBe(
      '356px',
    )
    expect(localStorage.getItem('wisp-notes:sidebar-width')).toBeNull() // saved when the drag ends
    fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 })
    expect(useUi.getState().sidebarWidth).toBe(400)
    expect(localStorage.getItem('wisp-notes:sidebar-width')).toBe('400')
    expect(handle).toHaveAttribute('aria-valuenow', '400')
  })

  it('keeps the width within limits, and supports keyboard and double-click reset', async () => {
    renderShell(<AppShell sidebar={<p>tree</p>} main={<p>content</p>} />)
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    handle.setPointerCapture = () => {}
    fireEvent.pointerDown(handle, { button: 0, clientX: 256, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: -500, pointerId: 1 })
    expect(useUi.getState().sidebarWidth).toBe(180)
    handle.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(useUi.getState().sidebarWidth).toBe(196)
    await userEvent.keyboard('{End}')
    expect(useUi.getState().sidebarWidth).toBe(600)
    await userEvent.dblClick(handle)
    expect(useUi.getState().sidebarWidth).toBe(256)
  })

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
