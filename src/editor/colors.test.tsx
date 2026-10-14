import { EditorSelection, EditorState } from '@codemirror/state'
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

  it('colors the text and hides the tags off the cursor line', () => {
    const view = setup(`Pay ${G('the deposit')} today\n\nend`)
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
    expect(document.querySelector('.cm-color-green')).toHaveTextContent('the deposit')
    expect(view.contentDOM.textContent).toContain('Pay the deposit today')
    view.dispatch({ selection: { anchor: 1 } })
    expect(view.contentDOM.textContent).toContain('<span style="color: green">')
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
