import { Cache } from '../cache/db.ts'
import { DriveClient } from '../drive/client.ts'
import { setupFakeDrive } from '../test/msw.ts'
import { RepoSession, useRepo } from './session.ts'

const fake = setupFakeDrive({
  files: {
    'Inbox.md': '# Inbox',
    'Work/Plan.md': 'plan ✨',
    'Work/_meta.json': '{"icon":"briefcase"}',
    'Home/Food.md': 'food',
  },
})

let dbn = 0
let dbName = ''
let sessions: RepoSession[] = []
let token = 'good-token'
beforeEach(() => {
  dbName = `session-${dbn++}`
  token = 'good-token'
})
afterEach(() => {
  sessions.forEach((s) => s.dispose())
  sessions = []
})

async function newSession(opts = {}) {
  const client = new DriveClient({ getToken: async () => token, invalidate: () => {} })
  const s = new RepoSession(client, await Cache.open(dbName), 'gdrive:me@example.com', {
    idleMs: 50,
    maxMs: 500,
    ...opts,
  })
  sessions.push(s)
  return s
}

const downloads = () => fake.drive.log.filter((l) => l.query.includes('alt=media'))
const paths = () =>
  useRepo
    .getState()
    .snapshot!.entries.map((e) => e.path)
    .sort()

describe('RepoSession loading & sync', () => {
  it('loads the tree (including folders) and folder metas', async () => {
    const s = await newSession()
    await s.start()
    const st = useRepo.getState()
    expect(st.phase).toBe('ready')
    expect(paths()).toEqual(['Home', 'Home/Food.md', 'Inbox.md', 'Work', 'Work/Plan.md', 'Work/_meta.json'])
    expect(st.metas).toEqual({ Work: { icon: 'briefcase' } })
    expect(await s.readNote('Work/Plan.md')).toBe('plan ✨')
  })

  it('creates the Wisp Notes folder on first use', async () => {
    fake.drive = new (fake.drive.constructor as typeof import('../test/fakeDrive.ts').FakeDrive)({
      noRoot: true,
    })
    const s = await newSession()
    await s.start()
    expect(useRepo.getState().phase).toBe('ready')
    expect(fake.drive.rootId).not.toBeNull()
    expect(paths()).toEqual([])
  })

  it('shows the cached tree instantly and works offline', async () => {
    const s1 = await newSession()
    await s1.start()
    await s1.readNote('Inbox.md')
    s1.dispose()

    fake.drive.offline = true
    const s2 = await newSession()
    await s2.start()
    const st = useRepo.getState()
    expect(st.phase).toBe('ready')
    expect(st.online).toBe(false)
    expect(st.metas).toEqual({ Work: { icon: 'briefcase' } })
    expect(await s2.readNote('Inbox.md')).toBe('# Inbox')
    await expect(s2.readNote('Home/Food.md')).rejects.toThrow('not available offline')
  })

  it('reports an error when offline without a cache', async () => {
    fake.drive.offline = true
    const s = await newSession()
    await s.start()
    expect(useRepo.getState().phase).toBe('error')
  })

  it('picks up changes from other devices and downloads only changed files', async () => {
    const s1 = await newSession()
    await s1.start()
    expect(await s1.prefetchNotes()).toBe(3)
    s1.dispose()

    fake.drive.write('Home/Food.md', 'more food')
    fake.drive.write('Home/New.md', 'new')
    fake.drive.log = []
    const s2 = await newSession()
    await s2.start()
    // Incremental: the changes feed, not a full listing.
    expect(fake.drive.log.some((l) => l.path === '/drive/v3/changes')).toBe(true)
    expect(fake.drive.log.some((l) => l.path === '/drive/v3/files')).toBe(false)
    expect(await s2.prefetchNotes()).toBe(2)
    expect(downloads()).toHaveLength(2)
    expect(await s2.readNote('Home/Food.md')).toBe('more food')
    expect(await s2.readNote('Inbox.md')).toBe('# Inbox')
    expect(downloads()).toHaveLength(2)
  })

  it('revalidate applies remote renames and deletes', async () => {
    const s = await newSession()
    await s.start()
    fake.drive.write('Inbox.md', null)
    fake.drive.mkdir('Empty')
    await s.revalidate()
    expect(paths()).toEqual(['Empty', 'Home', 'Home/Food.md', 'Work', 'Work/Plan.md', 'Work/_meta.json'])
  })

  it('falls back to a full listing when the change token is invalid', async () => {
    const s1 = await newSession()
    await s1.start()
    s1.dispose()
    const cache = await Cache.open(dbName)
    const snap = (await cache.getSnapshot('gdrive:me@example.com'))!
    await cache.putSnapshot('gdrive:me@example.com', { ...snap, changeToken: '99999' })
    const s2 = await newSession()
    await s2.start()
    expect(useRepo.getState().phase).toBe('ready')
    expect(paths()).toContain('Inbox.md')
  })

  it('flags expired sign-in without losing cached data', async () => {
    const s1 = await newSession()
    await s1.start()
    s1.dispose()
    token = 'expired'
    const s2 = await newSession()
    await s2.start()
    expect(useRepo.getState()).toMatchObject({ phase: 'ready', authRequired: true })
  })
})

describe('RepoSession drafts & auto-save', () => {
  it('saves edits to several notes in one batch', async () => {
    const s = await newSession()
    await s.start()
    await s.editNote('Inbox.md', 'a')
    await s.editNote('Work/Plan.md', 'b')
    expect(useRepo.getState().dirty).toEqual({ 'Inbox.md': true, 'Work/Plan.md': true })
    await vi.waitFor(() => expect(useRepo.getState().saveStatus).toBe('saved'))
    expect(fake.drive.files()).toMatchObject({ 'Inbox.md': 'a', 'Work/Plan.md': 'b' })
    expect(useRepo.getState().dirty).toEqual({})
  })

  it('restores and saves drafts after a reload', async () => {
    const s1 = await newSession({ idleMs: 60_000 })
    await s1.start()
    await s1.editNote('Inbox.md', 'unsaved work')
    s1.dispose() // "tab closed" before the debounce fired
    expect(fake.drive.files()['Inbox.md']).toBe('# Inbox')

    const s2 = await newSession()
    await s2.start()
    expect(await s2.readNote('Inbox.md')).toBe('unsaved work')
    await vi.waitFor(() => expect(fake.drive.files()['Inbox.md']).toBe('unsaved work'))
    await vi.waitFor(() => expect(useRepo.getState().dirty).toEqual({}))
  })

  it('creates a conflict copy when the note changed on another device', async () => {
    const s1 = await newSession({ idleMs: 60_000 })
    await s1.start()
    await s1.editNote('Inbox.md', 'mine')
    s1.dispose()
    fake.drive.write('Inbox.md', 'theirs')

    const s2 = await newSession({ now: () => new Date('2026-10-11T00:00:00Z') })
    await s2.start()
    await vi.waitFor(() => expect(fake.drive.files()['Inbox (conflict 2026-10-11).md']).toBe('mine'))
    expect(fake.drive.files()['Inbox.md']).toBe('theirs')
    expect(useRepo.getState().notices.at(-1)!.message).toContain('Inbox (conflict 2026-10-11).md')
  })

  it('checks Drive for changes right before saving', async () => {
    const s = await newSession({ idleMs: 60_000, now: () => new Date('2026-10-11T00:00:00Z') })
    await s.start()
    await s.readNote('Inbox.md')
    await s.editNote('Inbox.md', 'mine')
    fake.drive.write('Inbox.md', 'theirs') // after our sync, before our save
    await s.saver.saveNow()
    expect(fake.drive.files()).toMatchObject({
      'Inbox.md': 'theirs',
      'Inbox (conflict 2026-10-11).md': 'mine',
    })
  })

  it('reverting to the saved content clears the draft', async () => {
    const s = await newSession({ idleMs: 60_000 })
    await s.start()
    await s.readNote('Inbox.md')
    await s.editNote('Inbox.md', 'x')
    await s.editNote('Inbox.md', '# Inbox')
    expect(useRepo.getState().dirty).toEqual({})
  })

  it('keeps drafts while offline and saves when back online', async () => {
    const s = await newSession()
    await s.start()
    fake.drive.offline = true
    await s.editNote('Inbox.md', 'offline edit')
    await vi.waitFor(() => expect(useRepo.getState().saveStatus).toBe('offline'))
    fake.drive.offline = false
    await s.saver.saveNow()
    expect(useRepo.getState().saveStatus).toBe('saved')
    expect(fake.drive.files()['Inbox.md']).toBe('offline edit')
  })

  it('keeps drafts when sign-in expires and saves after signing in again', async () => {
    const s = await newSession()
    await s.start()
    token = 'expired'
    await s.editNote('Inbox.md', 'later')
    await vi.waitFor(() => expect(useRepo.getState().saveStatus).toBe('error'))
    expect(useRepo.getState().authRequired).toBe(true)
    token = 'good-token'
    await s.saver.saveNow()
    expect(fake.drive.files()['Inbox.md']).toBe('later')
  })
})

describe('RepoSession operations', () => {
  it('updates the tree immediately and rolls back on failure', async () => {
    const s = await newSession()
    await s.start()
    let visibleDuringWrite = false
    fake.drive.failNext = (m) => {
      if (m !== 'POST') return undefined
      visibleDuringWrite = s.exists('New.md')
      return { status: 500, body: { error: { message: 'boom' } } }
    }
    await expect(
      s.applyOptimistic([{ kind: 'write', path: 'New.md', content: '', base: null }]),
    ).rejects.toThrow()
    expect(visibleDuringWrite).toBe(true)
    expect(s.exists('New.md')).toBe(false)
  })

  it('a new note can be edited right away without a conflict copy', async () => {
    const s = await newSession({ idleMs: 60_000 })
    await s.start()
    const p = s.applyOptimistic([{ kind: 'write', path: 'Fresh.md', content: '', base: null }])
    await s.editNote('Fresh.md', 'hello') // before the create finished
    await p
    await s.saver.saveNow()
    expect(fake.drive.files()['Fresh.md']).toBe('hello')
    expect(Object.keys(fake.drive.files()).some((x) => x.includes('conflict'))).toBe(false)
  })

  it('imports files with progress', async () => {
    const s = await newSession()
    await s.start()
    const progress: number[] = []
    useRepo.subscribe((st) => st.importing && progress.push(st.importing.done))
    const res = await s.importFiles('Work', [
      { relativePath: 'Export/a.md', content: 'A' },
      { relativePath: 'Export/img/b.png', content: new Blob([new Uint8Array([1, 2, 3])]) },
    ])
    expect(res).toEqual({ imported: 2, failed: false })
    expect(fake.drive.files()['Work/Export/a.md']).toBe('A')
    expect([...fake.drive.bytes('Work/Export/img/b.png')!]).toEqual([1, 2, 3])
    expect(progress.at(-1)).toBe(2)
    expect(useRepo.getState().importing).toBeNull()
  })
})
