import { EditorView } from '@codemirror/view'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupFakeDrive } from '../test/msw.ts'
import { getEditorView, renderApp } from '../test/renderApp.tsx'
import { loadSettings } from './settings.ts'
import { isDark } from './theme.ts'

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
  html.classList.remove('dark')
})

describe('theme', () => {
  it('resolves explicit and system themes', () => {
    expect(isDark('dark', false)).toBe(true)
    expect(isDark('light', true)).toBe(false)
    expect(isDark('system', true)).toBe(true)
    expect(isDark('system', false)).toBe(false)
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
})
