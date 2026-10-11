import { highlightParts, makeSnippet, SearchIndex } from './index.ts'

const note = (path: string, content: string | undefined, version = content ?? 'x') => ({
  path,
  content,
  version,
})

function build() {
  const idx = new SearchIndex()
  idx.update([
    note('Work/Roadmap.md', 'Quarterly goals and milestones.'),
    note('Home/Groceries.md', 'Buy milk, eggs and a roadmap poster.'),
    note('Ideas.md', 'Café ☕ ideas: write about résumé tips'),
    note('Uncached.md', undefined),
    note('image.png', 'not a note'),
  ])
  return idx
}

describe('SearchIndex', () => {
  it('indexes title, path and content', () => {
    const idx = build()
    expect(idx.size).toBe(4)
    expect(idx.search('milestones').map((h) => h.path)).toEqual(['Work/Roadmap.md'])
    expect(idx.search('Home').map((h) => h.path)).toEqual(['Home/Groceries.md'])
    expect(idx.search('Uncached').map((h) => h.path)).toEqual(['Uncached.md'])
  })

  it('ranks title matches above content matches', () => {
    const hits = build().search('roadmap')
    expect(hits.map((h) => h.path)).toEqual(['Work/Roadmap.md', 'Home/Groceries.md'])
    expect(hits[0]!.snippet).toBeNull()
    expect(hits[1]!.snippet!.text.slice(hits[1]!.snippet!.matchStart, hits[1]!.snippet!.matchEnd)).toBe(
      'roadmap',
    )
  })

  it('supports prefix and fuzzy matching and accents', () => {
    const idx = build()
    expect(idx.search('miles').map((h) => h.path)).toEqual(['Work/Roadmap.md'])
    expect(idx.search('quartrly').map((h) => h.path)).toEqual(['Work/Roadmap.md'])
    expect(idx.search('résumé').map((h) => h.path)).toEqual(['Ideas.md'])
    expect(idx.search('café').map((h) => h.path)).toEqual(['Ideas.md'])
  })

  it('requires all words to match', () => {
    const idx = build()
    expect(idx.search('milk eggs').map((h) => h.path)).toEqual(['Home/Groceries.md'])
    expect(idx.search('milk goals')).toEqual([])
  })

  it('updates incrementally', () => {
    const idx = build()
    // Unchanged versions are skipped.
    expect(
      idx.update([
        note('Work/Roadmap.md', 'Quarterly goals and milestones.'),
        note('Home/Groceries.md', 'Bread only now.', 'v2'),
        note('Ideas.md', 'Café ☕ ideas: write about résumé tips'),
        note('Uncached.md', 'now cached zebra', 'u1'),
      ]),
    ).toBe(2)
    expect(idx.search('milk')).toEqual([])
    expect(idx.search('bread').map((h) => h.path)).toEqual(['Home/Groceries.md'])
    expect(idx.search('zebra').map((h) => h.path)).toEqual(['Uncached.md'])
    // Removal
    expect(idx.update([note('Ideas.md', 'Café ☕ ideas: write about résumé tips')])).toBe(3)
    expect(idx.search('bread')).toEqual([])
    expect(idx.size).toBe(1)
  })
})

describe('makeSnippet / highlightParts', () => {
  it('builds an excerpt around the first match', () => {
    const text = 'a '.repeat(100) + 'needle here ' + 'b '.repeat(100)
    const s = makeSnippet(text, ['needle'])!
    expect(s.text.startsWith('…')).toBe(true)
    expect(s.text.endsWith('…')).toBe(true)
    expect(s.text.slice(s.matchStart, s.matchEnd)).toBe('needle')
  })

  it('matches at word starts only', () => {
    expect(makeSnippet('spin pin', ['pin'])!.matchStart).toBe(5)
  })

  it('splits text into highlighted parts', () => {
    expect(highlightParts('Road map Roadmap', ['roadmap'])).toEqual([
      { text: 'Road map ', match: false },
      { text: 'Roadmap', match: true },
    ])
  })
})
