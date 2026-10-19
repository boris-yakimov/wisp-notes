import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { dashStartsList } from './markdownSyntax.ts'

/** Top-level block node names of `doc`. */
function blocks(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [dashStartsList] })],
  })
  const tree = ensureSyntaxTree(state, doc.length, 5000)!
  const out: string[] = []
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) out.push(c.name)
  return out
}

describe('dashStartsList', () => {
  it('a "-" typed under a sentence starts a bullet instead of turning the sentence into a heading', () => {
    for (const doc of ['A sentence\n-', 'A sentence\n- ', 'A sentence\n  -', 'A sentence\n- item']) {
      expect(blocks(doc), JSON.stringify(doc)).toEqual(['Paragraph', 'BulletList'])
    }
  })

  it('"--" under a sentence is plain text, not a heading', () => {
    expect(blocks('A sentence\n--')).toEqual(['Paragraph', 'Paragraph'])
  })

  it('keeps standard headings and rules', () => {
    expect(blocks('Title\n===')).toEqual(['SetextHeading1'])
    expect(blocks('Title\n---')).toEqual(['SetextHeading2'])
    expect(blocks('Text\n\n---')).toEqual(['Paragraph', 'HorizontalRule'])
    expect(blocks('- a\n- b')).toEqual(['BulletList'])
  })
})
