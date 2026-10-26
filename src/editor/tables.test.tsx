import { undo } from '@codemirror/commands'
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

  it('keeps the grid when the cursor would land in the table, moving it past the table', () => {
    const { view } = setup()
    view.dispatch({ selection: { anchor: DOC.indexOf('May 8') } })
    expect(table()).not.toBeNull()
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(9) // line after the table
    expect(view.contentDOM.textContent).not.toContain('|:--|:-:|--:|')
  })

  const cell = (row: number, col: number) =>
    table()!.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)!
  const click = (el: Element, init: MouseEventInit = {}) =>
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }))
  const input = () => document.querySelector<HTMLTextAreaElement>('.cm-table-input')!
  const key = (k: string, init: KeyboardEventInit = {}) =>
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))

  it('clicking a cell edits its Markdown in place; Enter saves only that cell', () => {
    const { view } = setup()
    click(cell(1, 1))
    expect(input().value).toBe('May 7')
    expect(document.activeElement).toBe(input())
    input().value = 'May 9 | late'
    key('Enter')
    expect(view.state.doc.line(7).text).toBe(
      '| [Arrival](italy/Arrival.md) | May 9 \\| late | **flight** 20:10; `a\\|b` |',
    )
    expect(input()).toBeNull()
    expect(cell(1, 1).textContent).toBe('May 9 | late')
  })

  it('Escape cancels; Tab moves on and adds a row after the last cell', () => {
    const { view } = setup()
    click(cell(0, 0))
    input().value = 'changed'
    key('Escape')
    expect(view.state.doc.toString()).toBe(DOC)
    expect(cell(0, 0).textContent).toBe('Activity')

    click(cell(2, 1))
    key('Tab')
    expect(input().closest('td')!.dataset).toMatchObject({ row: '2', col: '2' })
    input().value = 'done'
    key('Tab') // last cell: new row
    expect(view.state.doc.line(8).text).toBe('|  | May 8 | done |')
    expect(view.state.doc.line(9).text).toBe('|  |  |  |')
    expect(input().closest('td')!.dataset).toMatchObject({ row: '3', col: '0' })
    key('Tab', { shiftKey: true })
    expect(input().closest('td')!.dataset).toMatchObject({ row: '2', col: '2' })
  })

  it('opens a link in a cell with Ctrl/Cmd+click', () => {
    const { onOpenLink } = setup()
    const link = table()!.querySelector('.cm-table-link')!
    click(link, { ctrlKey: true })
    expect(onOpenLink).toHaveBeenCalledWith('italy/Arrival.md')
    expect(input()).toBeNull()
  })

  it('moving down or up over the table skips it', () => {
    const { view } = setup()
    const line = () => view.state.doc.lineAt(view.state.selection.main.head).number
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } }) // blank line above
    view.dispatch({ selection: { anchor: view.state.doc.line(5).from }, userEvent: 'select' })
    expect(line()).toBe(9)
    view.dispatch({ selection: { anchor: view.state.doc.line(8).from }, userEvent: 'select' })
    expect(line()).toBe(4)
    // A selection over the whole table is kept
    view.dispatch({ selection: { anchor: 0, head: DOC.length } })
    expect(view.state.selection.main).toMatchObject({ anchor: 0, head: DOC.length })
  })

  it('leaves tables as Markdown when live preview is off', () => {
    setup(false)
    expect(table()).toBeNull()
  })

  it('a table pasted at the end of a note gets a line below it to keep writing on', () => {
    const ref = createRef<EditorHandle>()
    render(<Editor ref={ref} content={'Before\n\n'} vimEnabled={false} livePreviewEnabled />)
    const view = ref.current!.view()!
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.dispatch({
      changes: { from: view.state.doc.length, insert: TABLE },
      selection: { anchor: view.state.doc.length + TABLE.length },
      userEvent: 'input.paste',
    })
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: view.state.doc.length }, userEvent: 'select' })
    expect(table()).not.toBeNull()
    expect(view.state.doc.toString()).toBe(`Before\n\n${TABLE}\n`)
    expect(view.state.selection.main.head).toBe(view.state.doc.length) // on the new last line
    view.dispatch(view.state.replaceSelection('After'))
    expect(view.state.doc.toString()).toBe(`Before\n\n${TABLE}\n\nAfter`)
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: 0 } })
    expect(findTables(view.state)[0]!.rows).toHaveLength(2) // "After" is not a table row
  })

  it('undo removes a paste below a table at the end, even after the cursor moved onto the table', () => {
    const ref = createRef<EditorHandle>()
    const doc = `Before\n\n${TABLE}`
    render(<Editor ref={ref} content={doc} vimEnabled={false} livePreviewEnabled />)
    const view = ref.current!.view()!
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: 0 } })
    view.dispatch({ selection: { anchor: view.state.doc.length }, userEvent: 'select' }) // adds a line
    expect(view.state.doc.toString()).toBe(`${doc}\n`)
    view.dispatch(view.state.replaceSelection('pasted'))
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    // Moving onto the (now longer) table adds a line again: that must not get in undo's way
    view.dispatch({ selection: { anchor: view.state.doc.length - 1 }, userEvent: 'select' })
    undo(view)
    expect(view.state.doc.toString()).not.toContain('pasted')
  })

  it('typing on the blank line right after a table keeps the text out of the table', () => {
    const { view } = setup()
    view.dispatch({ selection: { anchor: view.state.doc.line(9).from } }) // blank line after the table
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.toString()).toBe(`# Italy\n\nBefore\n\n${TABLE}\n\nx\nAfter`)
    expect(view.state.selection.main.head).toBe(view.state.doc.line(10).to)
  })

  it('deleting the blank line between a table and the text below keeps the text out of the table', () => {
    const { view } = setup()
    const doc = view.state.doc
    // Backspace at the start of "After": joins it to the blank line
    const blank = doc.line(9).from
    view.dispatch({ selection: { anchor: doc.line(10).from } })
    view.dispatch({
      changes: { from: blank, to: blank + 1 },
      selection: { anchor: blank },
      userEvent: 'delete.backward',
    })
    expect(view.state.doc.toString()).toBe(DOC)
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('After')
    // Deleting the blank line itself (vim dd)
    view.dispatch({
      changes: { from: doc.line(9).from, to: doc.line(10).from },
      userEvent: 'delete.line',
    })
    expect(view.state.doc.toString()).toBe(DOC)
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: 0 } })
    expect(findTables(view.state)[0]!.rows).toHaveLength(2)
  })
})
