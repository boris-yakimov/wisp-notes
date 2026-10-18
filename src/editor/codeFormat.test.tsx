import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { codeBlockChanges, inlineCode, inlineCodeChanges } from './codeFormat.ts'
import { Editor, type EditorHandle } from './Editor.tsx'

/** Apply a change function to `marked`, with the selection between `«` and `»` (a lone `|` = cursor). */
function run(marked: string, fn: (s: EditorState) => { from: number; to: number; insert: string }[]) {
  const cursor = marked.indexOf('|')
  const from = cursor >= 0 ? cursor : marked.indexOf('«')
  const to = cursor >= 0 ? cursor : marked.indexOf('»') - 1
  const doc = cursor >= 0 ? marked.replace('|', '') : marked.replace('«', '').replace('»', '')
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state.update({ changes: fn(state) }).state.doc.toString()
}

describe('mark as code', () => {
  it('wraps the selection in backticks, with enough of them for backticks inside', () => {
    expect(run('the first arg is «argv[0]» here', inlineCodeChanges)).toBe('the first arg is `argv[0]` here')
    expect(inlineCode('a`b')).toBe('``a`b``')
    expect(inlineCode('`x')).toBe('`` `x ``')
  })

  it('removes the backticks when the selection or cursor is inside inline code', () => {
    expect(run('use `ar|gv` here', inlineCodeChanges)).toBe('use argv here')
    expect(run('use `«argv»` here', inlineCodeChanges)).toBe('use argv here')
    expect(run('use `` `x| `` here', inlineCodeChanges)).toBe('use `x here')
  })

  it('does nothing for an empty selection outside code', () => {
    expect(run('plain| text', inlineCodeChanges)).toBe('plain text')
  })

  it('turns a selection over several lines into a code block', () => {
    expect(run('intro\n«int main() {\n  return 0;\n}»\nend', inlineCodeChanges)).toBe(
      'intro\n```\nint main() {\n  return 0;\n}\n```\nend',
    )
  })

  it('puts the selection in a code block on its own lines, splitting the line if needed', () => {
    expect(run('Call «argv[argc]» here', codeBlockChanges)).toBe('Call\n```\nargv[argc]\n```\nhere')
    expect(run('«whole line»\nnext', codeBlockChanges)).toBe('```\nwhole line\n```\nnext')
    expect(run('«has ``` inside»', codeBlockChanges)).toBe('````\nhas ``` inside\n````')
  })
})

describe('format toolbar and shortcut', () => {
  function setup(content: string) {
    const ref = createRef<EditorHandle>()
    render(<Editor ref={ref} content={content} vimEnabled={false} livePreviewEnabled />)
    return ref.current!.view()!
  }

  it('Code and Code block buttons in the selection toolbar', () => {
    const view = setup('see argv[0] now')
    view.dispatch({ selection: { anchor: 4, head: 11 } })
    document.querySelector<HTMLButtonElement>('[aria-label="Mark as code (Ctrl/Cmd+E)"]')!.click()
    expect(view.state.doc.toString()).toBe('see `argv[0]` now')
    view.dispatch({ selection: { anchor: 4, head: 13 } })
    document.querySelector<HTMLButtonElement>('[aria-label="Put in a code block"]')!.click()
    expect(view.state.doc.toString()).toBe('see\n```\n`argv[0]`\n```\nnow')
  })

  it('Ctrl+E toggles inline code', () => {
    const view = setup('see argv[0] now')
    view.dispatch({ selection: { anchor: 4, head: 11 } })
    const key = () =>
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true }),
      )
    key()
    expect(view.state.doc.toString()).toBe('see `argv[0]` now')
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: 7 } })
    key()
    expect(view.state.doc.toString()).toBe('see argv[0] now')
  })
})
