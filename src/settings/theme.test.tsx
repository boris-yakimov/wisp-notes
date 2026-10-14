import { EditorView } from '@codemirror/view'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupFakeDrive } from '../test/msw.ts'
import { getEditorView, renderApp } from '../test/renderApp.tsx'
import { loadSettings } from './settings.ts'
import { resolveTheme } from './theme.ts'

setupFakeDrive({ files: { 'Inbox.md': '# Inbox' } })

const html = document.documentElement
const realMatchMedia = window.matchMedia

/** Stub the OS preference; returns a function that flips it and fires `change`. */
function stubSystemDark(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  window.matchMedia = ((media: string) => {
    // Only the color-scheme query is stubbed; others (CodeMirror's `print`) get inert objects.
    if (!media.includes('prefers-color-scheme')) return realMatchMedia(media)
    return {
      get matches() {
        return matches
      },
      media,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }
  }) as unknown as typeof window.matchMedia
  return (next: boolean) => {
    matches = next
    listeners.forEach((l) => l())
  }
}

afterEach(() => {
  window.matchMedia = realMatchMedia
  html.classList.remove('dark', 'synthwave', 'terminal')
})

describe('theme', () => {
  it('resolves explicit and system themes', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('synthwave', false)).toBe('synthwave')
    expect(resolveTheme('terminal', false)).toBe('terminal')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('defaults to system and ignores invalid stored values', () => {
    expect(loadSettings().theme).toBe('system')
    localStorage.setItem('wisp-notes:settings', JSON.stringify({ theme: 'neon' }))
    expect(loadSettings().theme).toBe('system')
  })

  it('switches theme from Settings and persists it', async () => {
    renderApp('/settings')
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(html).toHaveClass('dark')
    expect(loadSettings().theme).toBe('dark')
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(html).not.toHaveClass('dark')
    expect(loadSettings().theme).toBe('light')
    await userEvent.click(screen.getByRole('radio', { name: 'Synthwave' }))
    expect(html).toHaveClass('dark', 'synthwave')
    expect(loadSettings().theme).toBe('synthwave')
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(html).toHaveClass('dark')
    expect(html).not.toHaveClass('synthwave')
    await userEvent.click(screen.getByRole('radio', { name: 'Terminal' }))
    expect(html).toHaveClass('dark', 'terminal')
    expect(html).not.toHaveClass('synthwave')
    expect(loadSettings().theme).toBe('terminal')
  })

  it('follows the OS preference live when set to system', async () => {
    const setSystem = stubSystemDark(true)
    renderApp('/n/Inbox.md', { theme: 'system' })
    await waitFor(() => expect(html).toHaveClass('dark'))
    await waitFor(() => expect(getEditorView().state.facet(EditorView.darkTheme)).toBe(true))
    setSystem(false)
    await waitFor(() => expect(html).not.toHaveClass('dark'))
    expect(getEditorView().state.facet(EditorView.darkTheme)).toBe(false)
  })
  it('synthwave gives the editor a dark scheme regardless of the OS', async () => {
    stubSystemDark(false)
    renderApp('/n/Inbox.md', { theme: 'synthwave' })
    await waitFor(() => expect(getEditorView().state.facet(EditorView.darkTheme)).toBe(true))
    expect(html).toHaveClass('synthwave')
  })
})
