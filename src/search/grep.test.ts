import { grepNotes, stripLine, type GrepNote } from './grep.ts'

const note = (path: string, content: string): GrepNote => ({
  path,
  name: path.replace(/\.md$/, '').split('/').pop()!,
  icon: undefined,
  parent: '',
  content,
})

describe('grepNotes', () => {
  const notes = [
    note('Plan.md', '# Plan\n\n  - Ship the Roadmap\n- roadmap review'),
    note('Other.md', 'nothing here\nROADMAP in caps'),
  ]

  it('finds every matching line, case-insensitively for lowercase queries', () => {
    const { hits, total } = grepNotes(notes, 'roadmap')
    expect(total).toBe(3)
    expect(hits.map((h) => [h.path, h.line, h.text])).toEqual([
      ['Plan.md', 3, '- Ship the Roadmap'], // indentation trimmed
      ['Plan.md', 4, '- roadmap review'],
      ['Other.md', 2, 'ROADMAP in caps'],
    ])
    expect(hits[0]!.textMatches).toEqual([11, 12, 13, 14, 15, 16, 17])
  })

  it('is case-sensitive when the query has uppercase letters (smart case)', () => {
    expect(grepNotes(notes, 'Roadmap').hits.map((h) => h.line)).toEqual([3])
  })

  it('returns the offsets of the first match in the raw content', () => {
    const h = grepNotes(notes, 'review').hits[0]!
    expect(notes[0]!.content.slice(h.from, h.to)).toBe('review')
    expect(h.match).toBe('review')
  })

  it('treats the query literally (no regex)', () => {
    expect(grepNotes([note('A.md', 'a.b and axb')], 'a.b').hits[0]!.textMatches).toEqual([0, 1, 2])
    expect(grepNotes([note('A.md', 'x')], '(').total).toBe(0)
  })

  it('ignores color tags: no matches in them, and they are not shown', () => {
    const colored = [note('C.md', 'Pay <span style="color: green">the deposit</span> now')]
    expect(grepNotes(colored, 'color').total).toBe(0)
    expect(grepNotes(colored, 'span').total).toBe(0)
    const h = grepNotes(colored, 'deposit now').hits[0]!
    expect(h.text).toBe('Pay the deposit now')
    expect(colored[0]!.content.slice(h.from, h.to)).toBe('deposit</span> now')
  })

  it('shortens long lines around the first match', () => {
    const long = 'x'.repeat(100) + ' needle ' + 'y'.repeat(400)
    const h = grepNotes([note('L.md', long)], 'needle').hits[0]!
    expect(h.text.startsWith('…')).toBe(true)
    expect(h.text.endsWith('…')).toBe(true)
    expect(h.text.slice(h.textMatches[0], h.textMatches[0]! + 6)).toBe('needle')
  })

  it('caps the hits but counts all matching lines', () => {
    const many = [note('M.md', Array.from({ length: 10 }, () => 'hit').join('\n'))]
    const r = grepNotes(many, 'hit', 3)
    expect(r.hits).toHaveLength(3)
    expect(r.total).toBe(10)
  })

  it('returns nothing for a blank query', () => {
    expect(grepNotes(notes, '  ')).toEqual({ hits: [], total: 0 })
  })
})

describe('stripLine', () => {
  it('maps stripped characters back to the raw line', () => {
    const raw = 'a<span style="color: red">bc</span>d'
    const { text, map } = stripLine(raw)
    expect(text).toBe('abcd')
    expect(map.map((i) => raw[i]).join('')).toBe('abcd')
  })
})
