import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { Editor, type EditorHandle } from './Editor.tsx'
import { linkAt } from './links.ts'

function stateFor(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

describe('linkAt', () => {
  const doc =
    'See [the plan](Plan%20x.md "t") and <https://a.example> or https://b.example, mail me@example.com.'
  const s = stateFor(doc)
  const at = (needle: string) => linkAt(s, doc.indexOf(needle) + 1)

  it('finds the target of inline links anywhere on the link', () => {
    expect(at('the plan')).toBe('Plan%20x.md')
    expect(at('[the')).toBe('Plan%20x.md')
    expect(at('Plan%20')).toBe('Plan%20x.md')
  })

  it('finds autolinks, bare URLs and e-mail addresses', () => {
    expect(at('https://a')).toBe('https://a.example')
    expect(at('https://b')).toBe('https://b.example')
    expect(at('me@')).toBe('me@example.com')
  })

  it('returns null outside links', () => {
    expect(at('See')).toBeNull()
    expect(at(' and ')).toBeNull()
  })
})

describe('Ctrl+click on a link', () => {
  const content = 'Go to [Inbox](../Inbox.md) now'

  // Clicks we don't handle reach CodeMirror's mouse selection, which needs layout APIs jsdom lacks.
  const proto = Range.prototype as { getClientRects?: () => DOMRectList }
  const hadRects = 'getClientRects' in proto
  beforeAll(() => {
    if (!hadRects) proto.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList
  })
  afterAll(() => {
    if (!hadRects) delete proto.getClientRects
  })

  function setup(vimEnabled: boolean) {
    const ref = createRef<EditorHandle>()
    const onOpenLink = vi.fn()
    render(
      <Editor
        ref={ref}
        content={content}
        vimEnabled={vimEnabled}
        livePreviewEnabled
        onOpenLink={onOpenLink}
      />,
    )
    const view = ref.current!.view()!
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    // jsdom has no layout: map the click straight to a document position.
    const click = (pos: number, init: MouseEventInit) => {
      view.posAtCoords = () => pos
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init })
      view.contentDOM.dispatchEvent(e)
      return e
    }
    return { view, onOpenLink, click }
  }

  it.each([true, false])('opens the link with Ctrl or Cmd (vim %s)', (vim) => {
    const { onOpenLink, click } = setup(vim)
    const e = click(content.indexOf('Inbox') + 1, { ctrlKey: true })
    expect(onOpenLink).toHaveBeenCalledWith('../Inbox.md')
    expect(e.defaultPrevented).toBe(true)
    click(content.indexOf('Inbox') + 1, { metaKey: true })
    expect(onOpenLink).toHaveBeenCalledTimes(2)
  })

  it('ignores plain clicks and Ctrl+clicks outside links', () => {
    const { onOpenLink, click } = setup(true)
    click(content.indexOf('Inbox') + 1, {})
    click(1, { ctrlKey: true })
    expect(onOpenLink).not.toHaveBeenCalled()
  })
})
