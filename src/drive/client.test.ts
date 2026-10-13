import { setupFakeDrive } from '../test/msw.ts'
import { DriveClient } from './client.ts'
import { md5Hex } from './md5.ts'
import { RemoteTree } from './remoteTree.ts'

const fake = setupFakeDrive({ files: { 'Inbox.md': '# Inbox ☕', 'Work/Plan.md': 'plan' } })

function client(token = 'good-token') {
  return new DriveClient({ getToken: async () => token, invalidate: vi.fn() })
}

async function tree(c = client()) {
  const rootId = await c.ensureRoot()
  return new RemoteTree({ rootId, changeToken: await c.getStartPageToken(), items: await c.listAll() })
}

describe('DriveClient', () => {
  it('finds the existing root folder', async () => {
    expect(await client().ensureRoot()).toBe(fake.drive.rootId)
  })

  it('creates the root folder on first use, once', async () => {
    fake.drive = new (fake.drive.constructor as typeof import('../test/fakeDrive.ts').FakeDrive)({
      noRoot: true,
    })
    const c = client()
    const id = await c.ensureRoot()
    expect(await c.ensureRoot()).toBe(id)
    expect(fake.drive.rootId).toBe(id)
  })

  it('lists all files and builds paths with md5 hashes', async () => {
    const t = await tree()
    expect(t.entries().map((e) => [e.path, e.folder])).toEqual(
      expect.arrayContaining([
        ['Inbox.md', false],
        ['Work', true],
        ['Work/Plan.md', false],
      ]),
    )
    expect(t.entry('Inbox.md')!.md5).toBe(md5Hex('# Inbox ☕'))
  })

  it('paginates listings', async () => {
    fake.drive.maxPageSize = 50
    for (let i = 0; i < 120; i++) fake.drive.write(`n${i}.md`, String(i))
    const items = await client().listAll()
    expect(items.length).toBeGreaterThan(120)
    expect(fake.drive.log.filter((l) => l.path === '/drive/v3/files').length).toBe(3)
  })

  it('paginates the changes feed', async () => {
    const c = client()
    const t = await tree(c)
    fake.drive.maxPageSize = 10
    for (let i = 0; i < 25; i++) fake.drive.write(`c${i}.md`, String(i))
    const { changes } = await c.listChanges(t.changeToken!)
    expect(changes.length).toBeGreaterThanOrEqual(25)
  })

  it('downloads UTF-8 content', async () => {
    const t = await tree()
    expect(await client().download(t.entry('Inbox.md')!.id)).toBe('# Inbox ☕')
  })

  it('creates, updates, renames, moves and trashes files', async () => {
    const c = client()
    const t = await tree(c)
    const f = await c.createFile('New 🎉.md', t.rootId, 'héllo')
    expect(f.md5).toBe(md5Hex('héllo'))
    expect(fake.drive.files()['New 🎉.md']).toBe('héllo')
    await c.updateContent(f.id, 'New 🎉.md', 'changed')
    expect(fake.drive.files()['New 🎉.md']).toBe('changed')
    await c.update(f.id, { name: 'Renamed.md', from: t.rootId, to: t.folderId('Work')! })
    expect(fake.drive.files()['Work/Renamed.md']).toBe('changed')
    await c.trash(f.id)
    expect(fake.drive.files()['Work/Renamed.md']).toBeUndefined()
  })

  it('uploads binary content unchanged', async () => {
    const c = client()
    const t = await tree(c)
    const bytes = new Uint8Array([0, 255, 137, 80, 78, 71, 13, 10])
    await c.createFile('shot.png', t.rootId, new Blob([bytes], { type: 'image/png' }))
    expect([...fake.drive.bytes('shot.png')!]).toEqual([...bytes])
  })

  it('reports changes since a token', async () => {
    const c = client()
    const t = await tree(c)
    fake.drive.write('Inbox.md', 'from phone')
    fake.drive.write('Work/Plan.md', null)
    const { changes, nextToken } = await c.listChanges(t.changeToken!)
    t.applyChanges(changes)
    t.changeToken = nextToken
    expect(t.entry('Inbox.md')!.md5).toBe(md5Hex('from phone'))
    expect(t.entry('Work/Plan.md')).toBeUndefined()
    expect((await c.listChanges(nextToken)).changes).toEqual([])
  })

  it('maps errors', async () => {
    const invalidate = vi.fn()
    const bad = new DriveClient({ getToken: async () => 'nope', invalidate })
    await expect(bad.listAll()).rejects.toMatchObject({ kind: 'auth' })
    expect(invalidate).toHaveBeenCalled()
    fake.drive.failNext = () => ({
      status: 403,
      body: { error: { message: 'Rate', errors: [{ reason: 'userRateLimitExceeded' }] } },
    })
    await expect(client().listAll()).rejects.toMatchObject({ kind: 'rate-limit' })
    fake.drive.failNext = () => ({
      status: 403,
      body: { error: { message: 'Full', errors: [{ reason: 'storageQuotaExceeded' }] } },
    })
    await expect(client().listAll()).rejects.toMatchObject({ kind: 'quota' })
    fake.drive.offline = true
    await expect(client().listAll()).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('RemoteTree', () => {
  const item = (id: string, name: string, parentId: string, folder = false) => ({
    id,
    name,
    parentId,
    folder,
    version: '1',
    ...(folder ? {} : { md5: id }),
  })

  it('derives paths, ignores unreachable items and disambiguates duplicates', () => {
    const t = new RemoteTree({
      rootId: 'r',
      changeToken: null,
      items: [
        item('a', 'Work', 'r', true),
        item('b', 'Plan.md', 'a'),
        item('c', 'Plan.md', 'a'),
        item('d', 'Elsewhere.md', 'other-folder'),
        item('e', 'a/b.md', 'r'),
      ],
    })
    expect(t.entries().map((e) => e.path)).toEqual(['Work', 'Work/Plan.md', 'Work/Plan (2).md'])
  })

  it('removes descendants with their folder', () => {
    const t = new RemoteTree({
      rootId: 'r',
      changeToken: null,
      items: [item('a', 'Work', 'r', true), item('b', 'Plan.md', 'a')],
    })
    t.applyChanges([{ fileId: 'a', item: null }])
    expect(t.entries()).toEqual([])
  })
})
