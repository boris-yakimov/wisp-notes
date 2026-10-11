import {
  countNotes,
  createFolderOp,
  createNoteOp,
  deleteFolderOp,
  deleteNoteOp,
  renameFolderOp,
  renameNoteOp,
  setFolderIconOp,
} from './ops.ts'

const entries = [
  { path: 'Inbox.md', sha: 's-inbox' },
  { path: 'Work/_meta.json', sha: 's-meta' },
  { path: 'Work/Plan.md', sha: 's-plan' },
  { path: 'Work/Sub/Deep.md', sha: 's-deep' },
  { path: 'Work/Sub/pic.png', sha: 's-pic' },
  { path: 'Home/Food.md', sha: 's-food' },
]
const exists = (p: string) => entries.some((e) => e.path === p)

describe('change-set builders', () => {
  it('createNoteOp adds .md and rejects duplicates and bad names', () => {
    expect(createNoteOp('Work', 'Ideas', exists)).toEqual({
      changes: [{ path: 'Work/Ideas.md', content: '' }],
      message: 'Create Work/Ideas.md',
      target: 'Work/Ideas.md',
    })
    expect(createNoteOp('', 'x.md', exists).target).toBe('x.md')
    expect(() => createNoteOp('Work', 'Plan', exists)).toThrow('already exists')
    expect(() => createNoteOp('', 'a/b', exists)).toThrow('slashes')
  })

  it('createFolderOp writes a _meta.json placeholder', () => {
    expect(createFolderOp('Work', 'Ideas', entries).changes).toEqual([
      { path: 'Work/Ideas/_meta.json', content: '{}\n' },
    ])
    expect(() => createFolderOp('', 'Home', entries)).toThrow('already exists')
  })

  it('renameNoteOp deletes the old path and reuses the blob', () => {
    const op = renameNoteOp('Work/Plan.md', 'Roadmap', entries)
    expect(op.changes).toEqual([
      { path: 'Work/Plan.md', content: null, baseSha: 's-plan' },
      { path: 'Work/Roadmap.md', content: { sha: 's-plan' }, baseSha: null },
    ])
    expect(op.moved).toEqual({ 'Work/Plan.md': 'Work/Roadmap.md' })
    expect(renameNoteOp('Work/Plan.md', 'Plan', entries).changes).toEqual([])
    expect(
      () => renameNoteOp('Inbox.md', 'Inbox', [...entries, { path: 'x.md', sha: '1' }]).changes,
    ).not.toThrow()
    expect(() => renameNoteOp('Work/Plan.md', 'Plan.md', entries)).not.toThrow()
  })

  it('renameNoteOp rejects collisions', () => {
    expect(() => renameNoteOp('Inbox.md', 'Inbox2', [...entries, { path: 'Inbox2.md', sha: 'z' }])).toThrow(
      'already exists',
    )
  })

  it('deleteNoteOp', () => {
    expect(deleteNoteOp('Inbox.md', entries).changes).toEqual([
      { path: 'Inbox.md', content: null, baseSha: 's-inbox' },
    ])
  })

  it('renameFolderOp moves every file (including non-notes and meta) in one change set', () => {
    const op = renameFolderOp('Work', 'Job', entries)
    expect(op.changes).toHaveLength(8)
    expect(op.moved).toEqual({
      'Work/_meta.json': 'Job/_meta.json',
      'Work/Plan.md': 'Job/Plan.md',
      'Work/Sub/Deep.md': 'Job/Sub/Deep.md',
      'Work/Sub/pic.png': 'Job/Sub/pic.png',
    })
    expect(op.changes.filter((c) => c.content === null).map((c) => c.path)).toEqual(Object.keys(op.moved!))
    expect(() => renameFolderOp('Work', 'Home', entries)).toThrow('already exists')
    expect(renameFolderOp('Work/Sub', 'Deeper', entries).target).toBe('Work/Deeper')
  })

  it('deleteFolderOp deletes everything inside', () => {
    const op = deleteFolderOp('Work', entries)
    expect(op.changes.map((c) => c.path)).toEqual([
      'Work/_meta.json',
      'Work/Plan.md',
      'Work/Sub/Deep.md',
      'Work/Sub/pic.png',
    ])
    expect(op.changes.every((c) => c.content === null)).toBe(true)
    expect(countNotes('Work', entries)).toBe(2)
  })

  it('does not treat "Workshop" as inside "Work"', () => {
    const e = [...entries, { path: 'Workshop/a.md', sha: 'w' }]
    expect(deleteFolderOp('Work', e).changes.map((c) => c.path)).not.toContain('Workshop/a.md')
  })

  it('setFolderIconOp writes or removes the icon, keeping other meta', () => {
    expect(setFolderIconOp('Work', 'briefcase', {}).changes).toEqual([
      { path: 'Work/_meta.json', content: '{\n  "icon": "briefcase"\n}\n' },
    ])
    expect(setFolderIconOp('Work', undefined, { icon: 'x' }).changes[0]!.content).toBe('{}\n')
  })
})
