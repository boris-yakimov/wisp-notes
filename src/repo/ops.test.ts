import type { Entry } from '../drive/remoteTree.ts'
import {
  countNotes,
  createFolderOp,
  createNoteOp,
  deleteFolderOp,
  deleteNoteOp,
  importOp,
  moveOp,
  moveTargets,
  placeOp,
  renameFolderOp,
  renameNoteOp,
  setFolderIconOp,
  setIconsOp,
  setNoteIconOp,
  shiftOp,
  suggestIcons,
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
    expect(() => createNoteOp('', 'a\\b', entries)).toThrow('backslashes')
    // A slash is part of the name, not a folder separator
    expect(createNoteOp('Work', 'CI/CD', entries).target).toBe('Work/CI\uE000CD.md')
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

  it('moveOp moves notes and folders with one rename', () => {
    expect(moveOp('Inbox.md', 'Work', entries)).toEqual({
      ops: [{ kind: 'rename', path: 'Inbox.md', to: 'Work/Inbox.md' }],
      target: 'Work/Inbox.md',
      moved: { 'Inbox.md': 'Work/Inbox.md' },
    })
    const op = moveOp('Work/Sub', 'Home', entries)
    expect(op.ops).toEqual([{ kind: 'rename', path: 'Work/Sub', to: 'Home/Sub' }])
    expect(op.moved).toMatchObject({ 'Work/Sub/Deep.md': 'Home/Sub/Deep.md' })
    expect(moveOp('Work/Plan.md', '', entries).target).toBe('Plan.md')
    expect(moveOp('Work/Plan.md', 'Work', entries).ops).toEqual([])
  })

  it('moveOp rejects moving a folder into itself and name clashes', () => {
    expect(() => moveOp('Work', 'Work/Sub', entries)).toThrow('cannot be moved into itself')
    expect(() => moveOp('Work', 'Work', entries)).toThrow('cannot be moved into itself')
    expect(() => moveOp('Home/Food.md', 'Work', [...entries, f('Work/Food.md')])).toThrow(
      'already exists in “Work”',
    )
    expect(() => moveOp('Inbox.md', 'Nope', entries)).toThrow('no longer exists')
  })

  it('moveTargets lists folders and notes, excluding the current parent and the item itself', () => {
    expect(moveTargets('Work/Plan.md', entries)).toEqual([
      '',
      'Home',
      'Home/Food',
      'Inbox',
      'Work/Sub',
      'Work/Sub/Deep',
    ])
    expect(moveTargets('Work', entries)).toEqual(['Home', 'Home/Food', 'Inbox'])
  })

  describe('sub-notes ("Plan.md" + "Plan/")', () => {
    const nested: Entry[] = [
      ...entries,
      d('Work/Plan'),
      f('Work/Plan/Step.md'),
      d('Work/Plan/Step'),
      f('Work/Plan/Step/Detail.md'),
    ]

    it("creates a sub-note in the note's folder and blocks note/folder name pairs", () => {
      expect(createNoteOp('Inbox', 'Today', entries).ops).toEqual([
        { kind: 'write', path: 'Inbox/Today.md', content: '', base: null },
      ])
      expect(() => createNoteOp('', 'Work', entries)).toThrow('A folder named "Work" already exists')
      expect(() => createFolderOp('', 'Inbox', entries)).toThrow('A note named "Inbox" already exists')
    })

    it('renames the note and its sub-notes folder', () => {
      const op = renameNoteOp('Work/Plan.md', 'Roadmap', nested)
      expect(op.ops).toEqual([
        { kind: 'rename', path: 'Work/Plan.md', to: 'Work/Roadmap.md' },
        { kind: 'rename', path: 'Work/Plan', to: 'Work/Roadmap' },
      ])
      expect(op.moved).toMatchObject({ 'Work/Plan/Step/Detail.md': 'Work/Roadmap/Step/Detail.md' })
      expect(() => renameNoteOp('Inbox.md', 'Work', entries)).toThrow('A folder named "Work" already exists')
    })

    it('deletes the note with its sub-notes', () => {
      expect(deleteNoteOp('Work/Plan.md', nested).ops).toEqual([
        { kind: 'trash', path: 'Work/Plan.md' },
        { kind: 'trash', path: 'Work/Plan' },
      ])
      expect(countNotes('Work/Plan', nested)).toBe(2)
    })

    it('moves a note under another note, with its sub-notes', () => {
      expect(moveOp('Inbox.md', 'Home/Food', entries)).toEqual({
        ops: [{ kind: 'rename', path: 'Inbox.md', to: 'Home/Food/Inbox.md' }],
        target: 'Home/Food/Inbox.md',
        moved: { 'Inbox.md': 'Home/Food/Inbox.md' },
      })
      const op = moveOp('Work/Plan.md', 'Inbox', nested)
      expect(op.ops).toEqual([
        { kind: 'rename', path: 'Work/Plan.md', to: 'Inbox/Plan.md' },
        { kind: 'rename', path: 'Work/Plan', to: 'Inbox/Plan' },
      ])
      expect(op.moved).toMatchObject({ 'Work/Plan/Step.md': 'Inbox/Plan/Step.md' })
    })

    it('rejects moving a note under itself or onto a same-named item', () => {
      expect(() => moveOp('Work/Plan.md', 'Work/Plan', nested)).toThrow('cannot be moved into itself')
      expect(() => moveOp('Work/Plan.md', 'Work/Plan/Step', nested)).toThrow('cannot be moved into itself')
      expect(() => moveOp('Inbox.md', 'Inbox', entries)).toThrow('cannot be moved into itself')
      expect(() => moveOp('Home/Food.md', 'Work', [...entries, d('Work/Food')])).toThrow('already exists')
      expect(moveTargets('Work/Plan.md', nested)).not.toContain('Work/Plan/Step')
    })
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

  describe("note icons (in the folder's _meta.json)", () => {
    const metas = { Work: { icon: 'briefcase', notes: { 'Plan.md': 'star' } } }
    const meta = (op: { ops: unknown[] }, i: number) => {
      const o = op.ops[i] as { kind: string; path: string; content: string }
      return [o.path, JSON.parse(o.content)]
    }

    it('setNoteIconOp sets and removes a note icon, keeping the folder icon', () => {
      expect(meta(setNoteIconOp('Work/Sub/Deep.md', 'book', {}), 0)).toEqual([
        'Work/Sub/_meta.json',
        { notes: { 'Deep.md': 'book' } },
      ])
      expect(meta(setNoteIconOp('Work/Plan.md', undefined, metas), 0)).toEqual([
        'Work/_meta.json',
        { icon: 'briefcase' },
      ])
      expect(meta(setNoteIconOp('Inbox.md', 'inbox', {}), 0)).toEqual([
        '_meta.json',
        { notes: { 'Inbox.md': 'inbox' } },
      ])
    })

    it('rename, move and delete carry the icon along', () => {
      const renamed = renameNoteOp('Work/Plan.md', 'Roadmap', entries, metas)
      expect(meta(renamed, 1)).toEqual([
        'Work/_meta.json',
        { icon: 'briefcase', notes: { 'Roadmap.md': 'star' } },
      ])
      const moved = moveOp('Work/Plan.md', 'Home', entries, metas)
      expect(moved.ops[0]).toEqual({ kind: 'rename', path: 'Work/Plan.md', to: 'Home/Plan.md' })
      expect(meta(moved, 1)).toEqual(['Work/_meta.json', { icon: 'briefcase' }])
      expect(meta(moved, 2)).toEqual(['Home/_meta.json', { notes: { 'Plan.md': 'star' } }])
      const deleted = deleteNoteOp('Work/Plan.md', entries, metas)
      expect(meta(deleted, 1)).toEqual(['Work/_meta.json', { icon: 'briefcase' }])
      expect(moveOp('Inbox.md', 'Home', entries, metas).ops).toHaveLength(1) // no icon: no meta write
    })
  })

  describe('auto-assign icons', () => {
    const tree: Entry[] = [
      d('DevOps'),
      f('DevOps/Docker.md'),
      f('DevOps/Kubernetes.md'),
      d('DevOps/Kubernetes'), // sub-notes of Kubernetes.md
      f('DevOps/Kubernetes/Helm.md'),
      d('DevOps/AWS'),
      f('DevOps/AWS/IAM.md'),
      f('DevOps/Random.md'),
      f('DevOps/pic.png'),
      f('Inbox.md'),
    ]
    const guess = (t: string) =>
      ({ Docker: 'container', Kubernetes: 'ship-wheel', Helm: 'ship-wheel', AWS: 'cloud', IAM: 'shield' })[t]

    it('suggests icons inside the folder for items without one, skipping sub-note folders', () => {
      const metas = { DevOps: { notes: { 'Docker.md': 'star' } } }
      expect(suggestIcons('DevOps', tree, metas, guess)).toEqual([
        { path: 'DevOps/AWS', folder: true, icon: 'cloud' },
        { path: 'DevOps/AWS/IAM.md', folder: false, icon: 'shield' },
        { path: 'DevOps/Kubernetes.md', folder: false, icon: 'ship-wheel' },
        { path: 'DevOps/Kubernetes/Helm.md', folder: false, icon: 'ship-wheel' },
      ])
      expect(suggestIcons('DevOps/Kubernetes', tree, {}, guess).map((s) => s.path)).toEqual([
        'DevOps/Kubernetes/Helm.md',
      ])
    })

    it('writes one _meta.json per folder, keeping existing meta', () => {
      const metas = { DevOps: { icon: 'infinity', notes: { 'Docker.md': 'star' } } }
      const op = setIconsOp(suggestIcons('DevOps', tree, metas, guess), metas)
      const written = Object.fromEntries(
        op.ops.map((o) => [o.path, JSON.parse((o as { content: string }).content) as unknown]),
      )
      expect(written).toEqual({
        'DevOps/_meta.json': {
          icon: 'infinity',
          notes: { 'Docker.md': 'star', 'Kubernetes.md': 'ship-wheel' },
        },
        'DevOps/AWS/_meta.json': { icon: 'cloud', notes: { 'IAM.md': 'shield' } },
        'DevOps/Kubernetes/_meta.json': { notes: { 'Helm.md': 'ship-wheel' } },
      })
    })
  })
})

describe('custom order', () => {
  const es: Entry[] = [f('A.md'), f('B.md'), d('Docs'), f('Docs/X.md'), f('Docs/Y.md')]
  const metaOf = (ops: { path: string; content?: unknown }[], path = '_meta.json') =>
    JSON.parse(ops.find((o) => o.path === path)!.content as string)

  it('places an item before/after a sibling, writing the full order', () => {
    const op = placeOp('B.md', 'A.md', 'before', es)
    expect(op.ops).toHaveLength(1)
    expect(metaOf(op.ops)).toEqual({ order: ['Docs', 'B.md', 'A.md'] })
  })

  it('shifts within the current order and keeps other meta fields', () => {
    const metas = { '': { icon: 'star', order: ['B.md', 'A.md', 'Docs'] } }
    expect(metaOf(shiftOp('Docs', -1, es, metas).ops)).toEqual({
      icon: 'star',
      order: ['B.md', 'Docs', 'A.md'],
    })
    expect(shiftOp('B.md', -1, es, metas).ops).toEqual([]) // already first
  })

  it('moves into another container at the drop position, updating both orders', () => {
    const metas = { '': { order: ['A.md', 'B.md', 'Docs'] }, Docs: { notes: { 'X.md': 'cat' } } }
    const op = placeOp('A.md', 'Docs/Y.md', 'before', es, metas)
    expect(op.ops[0]).toEqual({ kind: 'rename', path: 'A.md', to: 'Docs/A.md' })
    expect(metaOf(op.ops)).toEqual({ order: ['B.md', 'Docs'] })
    expect(metaOf(op.ops, 'Docs/_meta.json')).toEqual({
      notes: { 'X.md': 'cat' },
      order: ['X.md', 'A.md', 'Y.md'],
    })
    expect(op.moved).toEqual({ 'A.md': 'Docs/A.md' })
  })

  it('drops deleted items from the order', () => {
    const metas = { Docs: { order: ['Y.md', 'X.md'] } }
    expect(metaOf(deleteNoteOp('Docs/Y.md', es, metas).ops, 'Docs/_meta.json')).toEqual({ order: ['X.md'] })
    expect(metaOf(deleteFolderOp('Docs', es, { '': { order: ['Docs', 'A.md'] } }).ops)).toEqual({
      order: ['A.md'],
    })
  })

  it('keeps the position when a folder is renamed', () => {
    const op = renameFolderOp('Docs', 'Papers', es, { '': { order: ['Docs', 'A.md'] } })
    expect(metaOf(op.ops)).toEqual({ order: ['Papers', 'A.md'] })
  })
})
