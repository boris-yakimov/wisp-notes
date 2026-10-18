import { loadPosition, MAX_POSITIONS, savePosition } from './positions.ts'

const pos = (n: number) => ({ anchor: n, head: n, top: n, topOffset: 0 })

describe('note positions', () => {
  it('saves and loads per note', () => {
    savePosition('A.md', pos(5))
    savePosition('B.md', pos(9))
    expect(loadPosition('A.md')).toEqual(pos(5))
    expect(loadPosition('B.md')).toEqual(pos(9))
    expect(loadPosition('C.md')).toBeUndefined()
  })

  it('ignores corrupt storage', () => {
    localStorage.setItem('wisp-notes:positions', '{not json')
    expect(loadPosition('A.md')).toBeUndefined()
    localStorage.setItem('wisp-notes:positions', JSON.stringify({ 'A.md': { anchor: 'x' } }))
    expect(loadPosition('A.md')).toBeUndefined()
  })

  it('keeps only the most recently used notes', () => {
    for (let i = 0; i < MAX_POSITIONS; i++) savePosition(`n${i}.md`, pos(i))
    savePosition('n0.md', pos(1)) // touched again: now the newest
    savePosition('extra.md', pos(2))
    expect(loadPosition('n1.md')).toBeUndefined()
    expect(loadPosition('n0.md')).toEqual(pos(1))
    expect(loadPosition('extra.md')).toEqual(pos(2))
  })
})
