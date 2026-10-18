import { cursorCharLeft, cursorCharRight, deleteCharBackward } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { getCM, Vim } from '@replit/codemirror-vim'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { findColorSpans, stripColors } from '../repo/textColors.ts'
import { colorChanges, type TextColor } from './colors.ts'
import { Editor, type EditorHandle } from './Editor.tsx'

/** Apply `color` to `doc` with the selection between the `[` and `]` markers. */
function colorize(marked: string, color: TextColor | null): string {
  const from = marked.indexOf('[')
  const to = marked.indexOf(']') - 1
  const doc = marked.replace('[', '').replace(']', '')
  const state = EditorState.create({ doc, selection: EditorSelection.range(from, to) })
  return state.update({ changes: colorChanges(state, color) }).state.doc.toString()
}
const G = (t: string) => `<span style="color: green">${t}</span>`
const R = (t: string) => `<span style="color: red">${t}</span>`
const O = (t: string) => `<span style="color: orange">${t}</span>`
const B = (t: string) => `<span style="color: blue">${t}</span>`

describe('text colors', () => {
  it('finds colored spans and strips them for search', () => {
    const text = `a ${G('ok')} b ${R('no')} c ${O('maybe')} d ${B('info')}`
    expect(findColorSpans(text).map((s) => [s.color, text.slice(s.textFrom, s.textTo)])).toEqual([
      ['green', 'ok'],
      ['red', 'no'],
      ['orange', 'maybe'],
      ['blue', 'info'],
    ])
    expect(stripColors(text)).toBe('a ok b no c maybe d info')
    expect(findColorSpans('<span style="color: teal">x</span> <span onclick="x">y</span>')).toEqual([])
  })

  it('wraps the selection, per line', () => {
    expect(colorize('Pay [the deposit] today', 'green')).toBe(`Pay ${G('the deposit')} today`)
    expect(colorize('[one\ntwo]', 'red')).toBe(`${R('one')}\n${R('two')}`)
  })

  it('recolors or clears a span the selection is inside', () => {
    expect(colorize(`x ${G('[paid]')} y`, 'red')).toBe(`x ${R('paid')} y`)
    expect(colorize(`x ${R('[late]')} y`, 'orange')).toBe(`x ${O('late')} y`)
    expect(colorize(`x ${G('p[ai]d')} y`, null)).toBe('x paid y')
  })

  it('merges overlapping spans instead of nesting them', () => {
    expect(colorize(`[a ${G('b')} c]`, 'red')).toBe(R('a b c'))
    expect(colorize(`[a ${G('b')} c]`, null)).toBe('a b c')
  })
})

describe('text colors in the editor', () => {
  function setup(content: string, livePreview = true) {
    const ref = createRef<EditorHandle>()
    render(<Editor ref={ref} content={content} vimEnabled={false} livePreviewEnabled={livePreview} />)
    return ref.current!.view()!
  }

  it('shows the color toolbar for a selection and applies a color', () => {
    const view = setup('Pay the deposit today')
    expect(document.querySelector('.cm-color-toolbar')).toBeNull()
    view.dispatch({ selection: { anchor: 4, head: 15 } })
    const green = document.querySelector<HTMLButtonElement>('[aria-label="Color text green"]')!
    green.click()
    expect(view.state.doc.toString()).toBe(`Pay ${G('the deposit')} today`)
    expect(document.querySelector('.cm-color-toolbar')).toBeNull() // selection collapsed
  })

  it('colors the text and hides the tags, also on the cursor line', () => {
    const view = setup(`Pay ${G('the deposit')} today\n\nend`)
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
    expect(document.querySelector('.cm-color-green')).toHaveTextContent('the deposit')
    expect(view.contentDOM.textContent).toContain('Pay the deposit today')
    view.dispatch({ selection: { anchor: 1 } })
    expect(view.contentDOM.textContent).toContain('Pay the deposit today')
    expect(view.contentDOM.textContent).not.toContain('<span')
  })

  it('keeps the tags visible without live preview, still colored', () => {
    setup(`Pay ${R('late')}`, false)
    expect(document.querySelector('.cm-color-red')).toHaveTextContent('late')
    expect(document.querySelector('.cm-content')!.textContent).toContain('</span>')
  })

  it('offers every color in the toolbar', () => {
    const view = setup('Pay the deposit today')
    view.dispatch({ selection: { anchor: 4, head: 15 } })
    const labels = [...document.querySelectorAll('.cm-color-toolbar button')].map((b) => b.textContent)
    expect(labels).toEqual(['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Gray', 'Clear'])
    document.querySelector<HTMLButtonElement>('[aria-label="Color text orange"]')!.click()
    expect(view.state.doc.toString()).toBe(`Pay ${O('the deposit')} today`)
    expect(document.querySelector('.cm-color-orange')).toHaveTextContent('the deposit')
    view.dispatch({ selection: { anchor: 4, head: view.state.doc.length - 6 } })
    document.querySelector<HTMLButtonElement>('[aria-label="Color text blue"]')!.click()
    expect(view.state.doc.toString()).toBe('Pay <span style="color: blue">the deposit</span> today')
  })
})

describe('editing around hidden color tags', () => {
  const doc = `Pay ${G('the deposit')} today`
  const open = 4 // "<span …>" starts here
  const textFrom = open + '<span style="color: green">'.length
  const textTo = textFrom + 'the deposit'.length
  const close = textTo + '</span>'.length

  function setup(vimEnabled = false) {
    const ref = createRef<EditorHandle>()
    render(<Editor ref={ref} content={doc} vimEnabled={vimEnabled} livePreviewEnabled />)
    const view = ref.current!.view()!
    const keys = (ks: string[]) => ks.forEach((k) => Vim.handleKey(getCM(view)!, k, 'user'))
    const at = (pos: number) => view.dispatch({ selection: { anchor: pos } })
    const head = () => view.state.selection.main.head
    const text = () => view.state.doc.toString()
    return { view, keys, at, head, text }
  }

  it('moves the cursor over hidden tags in one step', () => {
    const { view, at, head } = setup()
    at(open - 1) // before the space
    cursorCharRight(view)
    expect(head()).toBe(textFrom) // before "the": no stop inside "<span …>"
    cursorCharLeft(view)
    expect(head()).toBe(open - 1) // back over the space
    at(textTo - 1)
    cursorCharRight(view)
    expect(head()).toBe(close) // after "deposit"
    cursorCharLeft(view)
    expect(head()).toBe(textTo - 1)
  })

  it('never leaves the cursor inside a tag (vim motions, clicks, jumps)', () => {
    const { keys, at, head } = setup(true)
    at(0)
    keys(['w']) // to "the"
    expect(head()).toBe(textFrom)
    keys(['h'])
    expect(head()).toBe(open - 1)
    keys(['l', 'l'])
    expect(head()).toBe(textFrom + 1)
    at(textTo + 3) // e.g. a click or search landing inside "</span>"
    expect(head()).toBe(close)
  })

  it('Backspace right after colored text deletes its last letter, not the tag', () => {
    const { view, at, text } = setup()
    at(close)
    deleteCharBackward(view)
    expect(text()).toBe(`Pay ${G('the deposi')} today`)
  })

  it('Backspace at the start of colored text deletes the character before it', () => {
    const { view, at, text } = setup()
    at(textFrom)
    deleteCharBackward(view)
    expect(text()).toBe(`Pay${G('the deposit')} today`)
  })

  it('deleting all the colored text removes its tags too', () => {
    const { view, text } = setup()
    view.dispatch({ changes: { from: textFrom, to: textTo }, userEvent: 'delete' })
    expect(text()).toBe('Pay  today')
  })

  it('deleting across a tag keeps it whole', () => {
    const { view, text } = setup()
    view.dispatch({ changes: { from: 0, to: textFrom + 4 }, userEvent: 'delete' })
    expect(text()).toBe(G('deposit') + ' today')
  })

  it('vim x and dw work on the visible text', () => {
    const { keys, at, text } = setup(true)
    at(textTo - 1)
    keys(['x'])
    expect(text()).toBe(`Pay ${G('the deposi')} today`)
    at(textFrom)
    keys(['d', 'w'])
    expect(text()).toBe(`Pay ${G('deposi')} today`)
  })
})
