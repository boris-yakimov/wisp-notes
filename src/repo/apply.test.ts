import { DriveClient } from '../drive/client.ts'
import { md5Hex } from '../drive/md5.ts'
import { RemoteTree } from '../drive/remoteTree.ts'
import { setupFakeDrive } from '../test/msw.ts'
import { applyOpsToEntries, executeOps } from './apply.ts'

const fake = setupFakeDrive({ files: { 'a.md': 'alpha', 'Work/b.md': 'beta', 'Work/_meta.json': '{}' } })
const client = () => new DriveClient({ getToken: async () => 'good-token', invalidate: () => {} })
const now = () => new Date('2026-10-11T12:00:00Z')

async function tree() {
  const c = client()
  return new RemoteTree({ rootId: await c.ensureRoot(), changeToken: null, items: await c.listAll() })
}

describe('executeOps', () => {
  it('updates existing files and creates new ones (with parent folders)', async () => {
    const t = await tree()
    const res = await executeOps(client(), t, [
      { kind: 'write', path: 'a.md', content: 'alpha 2 🎉', base: md5Hex('alpha') },
      { kind: 'write', path: 'New/Deep/c.md', content: 'C', base: null },
    ])
    expect(res.error).toBeUndefined()
    expect(res.saved).toEqual(['a.md', 'New/Deep/c.md'])
    expect(fake.drive.files()).toMatchObject({ 'a.md': 'alpha 2 🎉', 'New/Deep/c.md': 'C' })
    expect(t.entry('New/Deep/c.md')!.md5).toBe(md5Hex('C'))
    expect(fake.drive.folders()).toEqual(['New', 'New/Deep', 'Work'])
  })

  it('skips identical content', async () => {
    const t = await tree()
    const before = fake.drive.writeCount()
    const res = await executeOps(client(), t, [{ kind: 'write', path: 'a.md', content: 'alpha', base: null }])
    expect(res.saved).toEqual(['a.md'])
    expect(fake.drive.writeCount()).toBe(before)
  })

  it('writes a conflict copy when the file changed since our base', async () => {
    const t = await tree()
    fake.drive.write('a.md', 'theirs')
    const fresh = await tree()
    const res = await executeOps(
      client(),
      fresh,
      [{ kind: 'write', path: 'a.md', content: 'mine', base: md5Hex('alpha') }],
      {
        now,
      },
    )
    expect(res.conflicts).toEqual([{ path: 'a.md', copyPath: 'a (conflict 2026-10-11).md' }])
    expect(fake.drive.files()).toMatchObject({ 'a.md': 'theirs', 'a (conflict 2026-10-11).md': 'mine' })
    void t
  })

  it('writes a conflict copy when a "new" file already exists with other content', async () => {
    const t = await tree()
    const res = await executeOps(
      client(),
      t,
      [{ kind: 'write', path: 'a.md', content: 'mine', base: null }],
      { now },
    )
    expect(res.conflicts).toHaveLength(1)
    expect(fake.drive.files()['a.md']).toBe('alpha')
  })

  it('overwrites without a check when base is undefined', async () => {
    const t = await tree()
    await executeOps(client(), t, [{ kind: 'write', path: 'Work/_meta.json', content: '{"icon":"star"}' }])
    expect(fake.drive.files()['Work/_meta.json']).toBe('{"icon":"star"}')
  })

  it('recreates a note that was deleted on another device', async () => {
    fake.drive.write('a.md', null)
    const t = await tree()
    const res = await executeOps(client(), t, [
      { kind: 'write', path: 'a.md', content: 'mine', base: md5Hex('alpha') },
    ])
    expect(res.conflicts).toEqual([])
    expect(fake.drive.files()['a.md']).toBe('mine')
  })

  it('renames a folder with one request; children move with it', async () => {
    const t = await tree()
    const before = fake.drive.writeCount()
    await executeOps(client(), t, [{ kind: 'rename', path: 'Work', to: 'Job' }])
    expect(fake.drive.writeCount() - before).toBe(1)
    expect(fake.drive.files()).toMatchObject({ 'Job/b.md': 'beta', 'Job/_meta.json': '{}' })
    expect(t.entry('Job/b.md')).toBeDefined()
  })

  it('moves a file to another folder', async () => {
    const t = await tree()
    await executeOps(client(), t, [{ kind: 'rename', path: 'a.md', to: 'Work/a2.md' }])
    expect(fake.drive.files()['Work/a2.md']).toBe('alpha')
    expect(fake.drive.files()['a.md']).toBeUndefined()
  })

  it('trashes files and folders', async () => {
    const t = await tree()
    await executeOps(client(), t, [{ kind: 'trash', path: 'Work' }])
    expect(Object.keys(fake.drive.files())).toEqual(['a.md'])
    expect(t.entries().map((e) => e.path)).toEqual(['a.md'])
  })

  it('keeps partial progress and reports the first failure', async () => {
    const t = await tree()
    let n = 0
    fake.drive.failNext = (m, p) =>
      m === 'POST' && p.startsWith('/upload') && n++ === 0 ? { status: 500, body: {} } : undefined
    const res = await executeOps(
      client(),
      t,
      [
        { kind: 'write', path: 'x.md', content: 'x', base: null },
        { kind: 'write', path: 'a.md', content: 'A', base: md5Hex('alpha') },
      ],
      { concurrency: 1 },
    )
    expect(res.error).toBeDefined()
    expect(res.saved).toEqual(['a.md'])
    expect(fake.drive.files()['a.md']).toBe('A')
  })

  it('creates a shared parent folder only once for parallel writes', async () => {
    const t = await tree()
    await executeOps(client(), t, [
      { kind: 'write', path: 'Imp/1.md', content: '1', base: null },
      { kind: 'write', path: 'Imp/2.md', content: '2', base: null },
      { kind: 'write', path: 'Imp/3.md', content: '3', base: null },
    ])
    expect(fake.drive.folders()).toEqual(['Imp', 'Work'])
  })

  it('stops structural ops at the first failure', async () => {
    const t = await tree()
    const res = await executeOps(client(), t, [
      { kind: 'trash', path: 'missing.md' },
      { kind: 'trash', path: 'a.md' },
    ])
    expect(res.error).toMatchObject({ kind: 'not-found' })
    expect(fake.drive.files()['a.md']).toBe('alpha')
  })
})

describe('applyOpsToEntries', () => {
  const entries = [
    { path: 'a.md', id: '1', folder: false, md5: 'x' },
    { path: 'Work', id: '2', folder: true },
    { path: 'Work/b.md', id: '3', folder: false, md5: 'y' },
  ]
  it('applies writes, mkdirs, renames and trashes', () => {
    const out = applyOpsToEntries(entries, [
      { kind: 'write', path: 'New/c.md', content: '', base: null },
      { kind: 'rename', path: 'Work', to: 'Job' },
      { kind: 'trash', path: 'a.md' },
      { kind: 'mkdir', path: 'Empty' },
    ])
    expect(out.map((e) => e.path).sort()).toEqual(['Empty', 'Job', 'Job/b.md', 'New', 'New/c.md'])
    expect(out.find((e) => e.path === 'New/c.md')!.md5).toBe(md5Hex(''))
    expect(out.find((e) => e.path === 'Job/b.md')!.id).toBe('3')
  })
})
