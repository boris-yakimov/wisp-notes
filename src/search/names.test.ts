import { buildTree } from '../repo/tree.ts'
import { markRuns, matchTerm, searchNames } from './names.ts'

describe('matchTerm', () => {
  it('matches substrings anywhere, case-insensitively', () => {
    expect(matchTerm('Roadmap', 'map')?.indices).toEqual([4, 5, 6])
    expect(matchTerm('Roadmap', 'ROAD'.toLowerCase())?.indices).toEqual([0, 1, 2, 3])
  })

  it('prefers an occurrence at the start of a word', () => {
    expect(matchTerm('Asia trip to Taipei', 'ta')?.indices).toEqual([13, 14])
  })

  it('falls back to a subsequence', () => {
    expect(matchTerm('Groceries', 'grcr')?.indices).toEqual([0, 1, 3, 5])
    expect(matchTerm('Groceries', 'xyz')).toBeNull()
    expect(matchTerm('Groceries', 'rg')).toBeNull() // order matters
  })

  it('ranks exact > prefix > word start > inside a word > subsequence', () => {
    const s = (text: string, t: string) => matchTerm(text, t)!.score
    expect(s('Plan', 'plan')).toBeGreaterThan(s('Planning', 'plan'))
    expect(s('Planning', 'plan')).toBeGreaterThan(s('Big plans', 'plan'))
    expect(s('Big plans', 'plan')).toBeGreaterThan(s('Explanation', 'plan'))
    expect(s('Explanation', 'plan')).toBeGreaterThan(s('Pale lantern', 'plan'))
  })
})

describe('searchNames', () => {
  const root = buildTree(
    ['Work/Roadmap.md', 'Work/Roadmap/Q1.md', 'Home/Groceries.md', 'Ideas.md', 'Archive/_meta.json'],
    {},
    ['Empty folder'],
  )

  it('searches notes, sub-notes and folders by name', () => {
    expect(searchNames(root, 'q1').map((h) => h.path)).toEqual(['Work/Roadmap/Q1.md'])
    expect(searchNames(root, 'empty').map((h) => [h.kind, h.path])).toEqual([['folder', 'Empty folder']])
    expect(searchNames(root, 'chive').map((h) => h.path)).toEqual(['Archive'])
  })

  it('does not list a note’s sub-note folder separately', () => {
    expect(searchNames(root, 'roadmap').map((h) => h.path)).toEqual(['Work/Roadmap.md', 'Work/Roadmap/Q1.md'])
  })

  it('requires every term to match the name or the parent path', () => {
    const hits = searchNames(root, 'road q')
    expect(hits.map((h) => h.path)).toEqual(['Work/Roadmap/Q1.md'])
    expect(hits[0]!.parent).toBe('Work / Roadmap')
    expect(hits[0]!.nameMatches).toEqual([0])
    expect(hits[0]!.parentMatches).toEqual([7, 8, 9, 10])
    expect(searchNames(root, '   ')).toEqual([])
  })
})

describe('markRuns', () => {
  it('groups consecutive marked characters', () => {
    expect(markRuns('Roadmap', [1, 2, 5])).toEqual([
      { text: 'R', match: false },
      { text: 'oa', match: true },
      { text: 'dm', match: false },
      { text: 'a', match: true },
      { text: 'p', match: false },
    ])
  })
})
