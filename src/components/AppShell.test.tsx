import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from './AppShell.tsx'

describe('AppShell', () => {
  it('renders title, sidebar and main pane', () => {
    render(<AppShell sidebar={<p>tree</p>} main={<p>content</p>} />)
    expect(screen.getByRole('heading', { name: 'Wisp Notes' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Notes' })).toHaveTextContent('tree')
    expect(screen.getByRole('main')).toHaveTextContent('content')
  })

  it('collapses the sidebar', async () => {
    render(<AppShell sidebar={<p>tree</p>} main={<p>content</p>} />)
    await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(screen.queryByRole('navigation', { name: 'Notes' })).not.toBeInTheDocument()
  })
})
