import { render } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { MemoryRouter } from 'react-router'
import App from '../App.tsx'
import { defaultSettings, saveSettings, type Settings } from '../settings/settings.ts'
import { useApp } from '../store/app.ts'

export function renderApp(url = '/', settings: Partial<Settings> = {}) {
  const s = {
    ...defaultSettings,
    token: 'good-token',
    owner: 'me',
    repo: 'notes',
    branch: 'main',
    ...settings,
  }
  saveSettings(s)
  useApp.setState({ settings: s })
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  )
}

/** The CodeMirror view rendered in the document. */
export function getEditorView(): EditorView {
  const dom = document.querySelector('.cm-editor')
  if (!dom) throw new Error('no editor')
  const view = EditorView.findFromDOM(dom as HTMLElement)
  if (!view) throw new Error('no view')
  return view
}

/** Simulate typing at the end of the document (as a user input transaction). */
export function typeInEditor(text: string, at?: number) {
  const view = getEditorView()
  const pos = at ?? view.state.doc.length
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: 'input.type',
  })
}

/** Send a key to the editor content (goes through CodeMirror keymaps incl. vim). */
export function pressKey(key: string, opts: KeyboardEventInit = {}) {
  const view = getEditorView()
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  view.contentDOM.dispatchEvent(ev)
}
