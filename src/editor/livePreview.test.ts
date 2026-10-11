import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { computeDecorations, livePreview, toggleTaskAt, type DecoSpec } from './livePreview.ts'

function stateFor(doc: string, cursor: number) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

const decos = (doc: string, cursor: number, focused = true) => {
  const s = stateFor(doc, cursor)
  return computeDecorations(s, [{ from: 0, to: s.doc.length }], focused)
}
/** Text hidden by the decorations. */
const hiddenText = (doc: string, specs: DecoSpec[]) =>
  specs.filter((d) => d.kind === 'hide').map((d) => doc.slice(d.from, d.to))

describe('computeDecorations', () => {
  const doc = '# Title\n\nSome **bold** and _it_ and `code`.\n\n[link](https://x.y) end'
  const lastLine = doc.length

  it('hides markers on inactive lines', () => {
    const d = decos(doc, lastLine)
    expect(hiddenText(doc, d)).toEqual(['# ', '**', '**', '_', '_', '`', '`'])
    expect(d.find((x) => x.kind === 'line' && x.value === 'cm-lp-h1')).toMatchObject({ from: 0 })
  })

  it('shows raw syntax on the active line', () => {
    const d = decos(doc, 3) // inside "# Title"
    const hidden = hiddenText(doc, d)
    expect(hidden).not.toContain('# ')
    expect(hidden).toContain('**')
    // link on last line is hidden since the cursor is on line 1
    expect(hidden).toContain('](https://x.y)')
  })

  it('hides link syntax except the text', () => {
    const d = decos(doc, 0)
    expect(hiddenText(doc, d)).toEqual(expect.arrayContaining(['[', '](https://x.y)']))
    const onLink = decos(doc, lastLine - 2)
    expect(hiddenText(doc, onLink)).not.toContain('[')
  })

  it('hides markers on every line when the editor is not focused', () => {
    const d = decos(doc, 3, false)
    expect(hiddenText(doc, d)).toContain('# ')
  })

  it('handles multi-line selections as active', () => {
    const s = EditorState.create({
      doc,
      selection: EditorSelection.range(0, 20),
      extensions: [markdown({ base: markdownLanguage })],
    })
    ensureSyntaxTree(s, s.doc.length, 5000)
    const hidden = hiddenText(doc, computeDecorations(s, [{ from: 0, to: doc.length }]))
    expect(hidden).not.toContain('# ')
    expect(hidden).not.toContain('**')
  })

  it('renders task markers as checkboxes and bullets as widgets', () => {
    const t = '- [ ] open\n- [x] done\n- plain\n\nend'
    const d = decos(t, t.length)
    expect(d.filter((x) => x.kind === 'checkbox').map((x) => [t.slice(x.from, x.to), x.value])).toEqual([
      ['[ ]', 'unchecked'],
      ['[x]', 'checked'],
    ])
    expect(d.filter((x) => x.kind === 'bullet')).toHaveLength(1)
    expect(hiddenText(t, d)).toEqual(['- ', '- '])
  })

  it('keeps the checkbox but shows the list mark on the active line', () => {
    const t = '- [ ] open\n\nend'
    const d = decos(t, 9)
    expect(d.filter((x) => x.kind === 'checkbox')).toHaveLength(1)
    expect(hiddenText(t, d)).toEqual([])
  })

  it('styles blockquotes and fenced code, keeping fences', () => {
    const t = '> quoted\n\n```js\nlet a\n```\n\nend'
    const d = decos(t, t.length)
    expect(d.filter((x) => x.value === 'cm-lp-quote')).toHaveLength(1)
    expect(d.filter((x) => x.value === 'cm-lp-codeblock')).toHaveLength(3)
    expect(hiddenText(t, d)).toEqual(['> '])
  })

  it('never hides text around the cursor, so vim motions see raw text', () => {
    const t = '# H\n**b** _i_ `c` [l](u)\n- [ ] task\n> q'
    for (let pos = 0; pos <= t.length; pos++) {
      const d = decos(t, pos).filter((x) => x.kind !== 'line')
      expect(d.filter((x) => x.from <= pos && pos <= x.to && x.kind !== 'checkbox')).toEqual([])
    }
  })

  it('only decorates the requested ranges', () => {
    const t = '**a**\n\n**b**'
    const s = stateFor(t, 0)
    const d = computeDecorations(s, [{ from: 7, to: t.length }])
    expect(d.every((x) => x.from >= 7)).toBe(true)
  })
})

describe('toggleTaskAt', () => {
  it('toggles the checkbox source text', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '- [ ] task\n- [x] done',
        extensions: [markdown({ base: markdownLanguage }), livePreview()],
      }),
    })
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    expect(toggleTaskAt(view, 3)).toBe(true)
    expect(view.state.doc.toString()).toBe('- [x] task\n- [x] done')
    expect(toggleTaskAt(view, 14)).toBe(true)
    expect(view.state.doc.toString()).toBe('- [x] task\n- [ ] done')
    expect(toggleTaskAt(view, 8)).toBe(false)
    view.destroy()
  })
})
