import type { Entry } from '../drive/remoteTree.ts'
import {
  countNotes,
  createFolderOp,
  createNoteOp,
  deleteFolderOp,
  deleteNoteOp,
  importOp,
  renameFolderOp,
  renameNoteOp,
  setFolderIconOp,
} from './ops.ts'

const f = (path: string): Entry => ({ path, id: path, folder: false, md5: 'h' })
const d = (path: string): Entry => ({ path, id: path, folder: true })
const entries: Entry[] = [
  f('Inbox.md'),
  d('Work'),
  f('Work/_meta.json'),
  f('Work/Plan.md'),
  d('Work/Sub'),
  f('Work/Sub/Deep.md'),
  f('Work/Sub/pic.png'),
  d('Home'),
  f('Home/Food.md'),
]

describe('operation builders', () => {
  it('createNoteOp adds .md and rejects duplicates and bad names', () => {
    expect(createNoteOp('Work', 'Ideas', entries)).toEqual({
      ops: [{ kind: 'write', path: 'Work/Ideas.md', content: '', base: null }],
      target: 'Work/Ideas.md',
    })
    expect(createNoteOp('', 'x.md', entries).target).toBe('x.md')
    expect(() => createNoteOp('Work', 'plan', entries)).toThrow('already exists')
    expect(() => createNoteOp('', 'a/b', entries)).toThrow('slashes')
  })

  it('createFolderOp creates a real (empty) folder', () => {
    expect(createFolderOp('Work', 'Ideas', entries).ops).toEqual([{ kind: 'mkdir', path: 'Work/Ideas' }])
    expect(() => createFolderOp('', 'Home', entries)).toThrow('already exists')
  })

  it('renameNoteOp is a single rename', () => {
    const op = renameNoteOp('Work/Plan.md', 'Roadmap', entries)
    expect(op.ops).toEqual([{ kind: 'rename', path: 'Work/Plan.md', to: 'Work/Roadmap.md' }])
    expect(op.moved).toEqual({ 'Work/Plan.md': 'Work/Roadmap.md' })
    expect(renameNoteOp('Work/Plan.md', 'Plan', entries).ops).toEqual([])
    expect(renameNoteOp('Work/Plan.md', 'plan', entries).ops).toHaveLength(1) // case-only
    expect(() => renameNoteOp('Inbox.md', 'Food', [...entries, f('Food.md')])).toThrow('already exists')
  })

  it('renameFolderOp is one rename and reports moved notes', () => {
    const op = renameFolderOp('Work', 'Job', entries)
    expect(op.ops).toEqual([{ kind: 'rename', path: 'Work', to: 'Job' }])
    expect(op.moved).toMatchObject({ 'Work/Plan.md': 'Job/Plan.md', 'Work/Sub/Deep.md': 'Job/Sub/Deep.md' })
    expect(() => renameFolderOp('Work', 'Home', entries)).toThrow('already exists')
  })

  it('delete ops trash the item', () => {
    expect(deleteNoteOp('Inbox.md', entries).ops).toEqual([{ kind: 'trash', path: 'Inbox.md' }])
    expect(deleteFolderOp('Work', entries).ops).toEqual([{ kind: 'trash', path: 'Work' }])
    expect(countNotes('Work', entries)).toBe(2)
    expect(() => deleteFolderOp('Inbox.md', entries)).toThrow('no longer exists')
  })

  it('setFolderIconOp writes _meta.json, keeping other meta', () => {
    expect(setFolderIconOp('Work', 'briefcase', {}).ops).toEqual([
      { kind: 'write', path: 'Work/_meta.json', content: '{\n  "icon": "briefcase"\n}\n' },
    ])
    expect((setFolderIconOp('Work', undefined, { icon: 'x' }).ops[0] as { content: string }).content).toBe(
      '{}\n',
    )
  })

  it('importOp keeps structure, skips hidden files and resolves clashes', () => {
    const op = importOp(
      '',
      [
        { relativePath: 'Export/Plan.md', content: 'a' },
        { relativePath: 'Export/img/shot.png', content: new Blob(['x']) },
        { relativePath: 'Export/.DS_Store', content: 'x' },
        { relativePath: 'Inbox.md', content: 'b' },
        { relativePath: 'Work/Plan.md', content: 'c' },
      ],
      entries,
    )
    expect(op.ops.map((o) => o.path)).toEqual([
      'Export/Plan.md',
      'Export/img/shot.png',
      'Inbox (2).md',
      'Work (2)/Plan.md',
    ])
    expect(op.ops.every((o) => o.kind === 'write' && o.base === null)).toBe(true)
  })
})
