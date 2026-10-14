import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { Editor, type EditorHandle } from './Editor.tsx'
import { findTables, renderInline } from './tables.ts'

const TABLE = [
  '| Activity | Date | Notes |',
  '|:--|:-:|--:|',
  '| [Arrival](italy/Arrival.md) | May 7 | **flight** 20:10; `a\\|b` |',
  '|  | May 8 | |',
].join('\n')
const DOC = `# Italy\n\nBefore\n\n${TABLE}\n\nAfter`

function stateFor(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

describe('findTables', () => {
  it('reads header, alignment and rows, keeping empty cells', () => {
    const [t] = findTables(stateFor(DOC))
    expect(t).toMatchObject({
      startLine: 5,
      endLine: 8,
      header: ['Activity', 'Date', 'Notes'],
      align: ['left', 'center', 'right'],
      rows: [
        ['[Arrival](italy/Arrival.md)', 'May 7', '**flight** 20:10; `a|b`'],
        ['', 'May 8', ''],
      ],
    })
  })
})

describe('renderInline', () => {
  const html = (s: string) => {
    const d = document.createElement('div')
    d.append(renderInline(s))
    return d.innerHTML
  }
  it('renders links, emphasis and code as DOM, everything else as text', () => {
    expect(html('[Arrival](a.md) **b** *i* ~~s~~ `c`')).toBe(
      '<span class="cm-table-link" data-href="a.md" title="a.md (Ctrl/Cmd+click to open)">Arrival</span> ' +
        '<strong>b</strong> <em>i</em> <del>s</del> <code>c</code>',
    )
    expect(html('<img src=x onerror=alert(1)> & <b>x</b>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt; &amp; &lt;b&gt;x&lt;/b&gt;',
    )
    expect(html('<https://example.com>')).toContain('data-href="https://example.com"')
  })
})

describe('table preview in the editor', () => {
  function setup(livePreview = true) {
    const ref = createRef<EditorHandle>()
    const onOpenLink = vi.fn()
    render(
      <Editor
        ref={ref}
        content={DOC}
        vimEnabled={false}
        livePreviewEnabled={livePreview}
        onOpenLink={onOpenLink}
      />,
    )
    const view = ref.current!.view()!
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: 0 } }) // let the table field see the full parse
    return { view, onOpenLink }
  }
  const table = () => document.querySelector('table.cm-table')

  it('draws the table as a grid while the cursor is elsewhere', () => {
    setup()
    expect(table()).not.toBeNull()
    const cells = [...table()!.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent))
    expect(cells).toEqual([
      ['Activity', 'Date', 'Notes'],
      ['Arrival', 'May 7', 'flight 20:10; a|b'],
      ['', 'May 8', ''],
    ])
    expect(table()!.querySelector('th:nth-child(3)')).toHaveStyle({ textAlign: 'right' })
  })

  it('shows Markdown when the cursor is in the table, and the grid again after', () => {
    const { view } = setup()
    view.dispatch({ selection: { anchor: DOC.indexOf('May 8') } })
    expect(table()).toBeNull()
    expect(view.contentDOM.textContent).toContain('|:--|:-:|--:|')
    view.dispatch({ selection: { anchor: DOC.length } })
    expect(table()).not.toBeNull()
  })

  it('opens a link in a cell with Ctrl/Cmd+click', () => {
    const { onOpenLink } = setup()
    const link = table()!.querySelector('.cm-table-link')!
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: true }))
    expect(onOpenLink).toHaveBeenCalledWith('italy/Arrival.md')
  })

  it('moving down from the line above enters the table instead of skipping it', () => {
    const { view } = setup()
    const above = view.state.doc.line(4) // blank line right above the table
    view.dispatch({ selection: { anchor: above.from } })
    // What a vertical motion over a block widget does: jump to the line after the table
    view.dispatch({ selection: { anchor: view.state.doc.line(9).from }, userEvent: 'select' })
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5)
    expect(table()).toBeNull()
    // A click is not redirected
    view.dispatch({ selection: { anchor: above.from } })
    view.dispatch({ selection: { anchor: view.state.doc.line(9).from }, userEvent: 'select.pointer' })
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(9)
  })

  it('leaves tables as Markdown when live preview is off', () => {
    setup(false)
    expect(table()).toBeNull()
  })
})
