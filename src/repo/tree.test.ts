import { buildTree, parseMeta } from './tree.ts'
import { conflictPath, noteTitle, validateName } from './paths.ts'

const names = (f: ReturnType<typeof buildTree>) => ({
  folders: f.folders.map((x) => x.name),
  notes: f.notes.map((x) => x.name),
})

describe('buildTree', () => {
  it('nests folders and notes', () => {
    const root = buildTree(['Work/Projects/Alpha.md', 'Work/Todo.md', 'Inbox.md'])
    expect(names(root)).toEqual({ folders: ['Work'], notes: ['Inbox'] })
    const work = root.folders[0]!
    expect(work.path).toBe('Work')
    expect(names(work)).toEqual({ folders: ['Projects'], notes: ['Todo'] })
    expect(work.folders[0]!.notes[0]).toEqual({ kind: 'note', path: 'Work/Projects/Alpha.md', name: 'Alpha' })
  })

  it('sorts folders first, then notes, alphabetically case-insensitive and numeric-aware', () => {
    const root = buildTree(['b.md', 'A.md', 'note 10.md', 'note 2.md', 'zeta/x.md', 'Alpha/y.md'])
    expect(names(root)).toEqual({ folders: ['Alpha', 'zeta'], notes: ['A', 'b', 'note 2', 'note 10'] })
  })

  it('ignores non-markdown files, hidden paths, and folders without notes', () => {
    const root = buildTree(['img/pic.png', '.github/workflows/ci.md', 'README.txt', 'a.md', 'Docs/x.MD'])
    expect(names(root)).toEqual({ folders: ['Docs'], notes: ['a'] })
  })

  it('shows empty folders that have a _meta.json', () => {
    const root = buildTree(['Empty/_meta.json'])
    expect(names(root)).toEqual({ folders: ['Empty'], notes: [] })
  })

  it('attaches icons from metas and leaves missing meta undefined', () => {
    const root = buildTree(['Work/a.md', 'Home/b.md'], { Work: { icon: 'briefcase' } })
    expect(root.folders.map((f) => [f.name, f.icon])).toEqual([
      ['Home', undefined],
      ['Work', 'briefcase'],
    ])
  })
})

describe('parseMeta', () => {
  it('parses icon, tolerates garbage', () => {
    expect(parseMeta('{"icon":"book-open"}')).toEqual({ icon: 'book-open' })
    expect(parseMeta('not json')).toEqual({})
    expect(parseMeta('{"icon":5}')).toEqual({})
    expect(parseMeta(undefined)).toEqual({})
  })
})

describe('paths', () => {
  it('noteTitle strips extension', () => expect(noteTitle('a/b/My Note.md')).toBe('My Note'))
  it('validateName', () => {
    expect(validateName('ok')).toBeNull()
    expect(validateName('a/b')).not.toBeNull()
    expect(validateName('  ')).not.toBeNull()
    expect(validateName('.hidden')).not.toBeNull()
  })
  it('conflictPath is unique', () => {
    const d = new Date('2026-10-11T10:00:00Z')
    expect(conflictPath('W/Plan.md', d, () => false)).toBe('W/Plan (conflict 2026-10-11).md')
    const taken = new Set(['W/Plan (conflict 2026-10-11).md'])
    expect(conflictPath('W/Plan.md', d, (p) => taken.has(p))).toBe('W/Plan (conflict 2026-10-11 2).md')
  })
})
