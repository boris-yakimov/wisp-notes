import { Cache } from '../cache/db.ts'
import { GitHubClient } from '../github/client.ts'
import { setupFakeGitHub } from '../test/msw.ts'
import { RepoSession, useRepo } from './session.ts'

const fake = setupFakeGitHub({
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
beforeEach(() => {
  dbName = `session-${dbn++}`
})
afterEach(() => {
  sessions.forEach((s) => s.dispose())
  sessions = []
})

async function newSession(opts = {}) {
  const client = new GitHubClient({ token: 'good-token', owner: 'me', repo: 'notes', branch: 'main' })
  const s = new RepoSession(client, await Cache.open(dbName), 'me/notes@main', {
    idleMs: 50,
    maxMs: 500,
    ...opts,
  })
  sessions.push(s)
  return s
}

const blobGets = () => fake.gh.log.filter((l) => l.path.includes('/git/blobs/') && l.method === 'GET')

describe('RepoSession loading & cache', () => {
  it('loads the tree and folder metas', async () => {
    const s = await newSession()
    await s.start()
    const st = useRepo.getState()
    expect(st.phase).toBe('ready')
    expect(st.snapshot!.entries).toHaveLength(4)
    expect(st.metas).toEqual({ Work: { icon: 'briefcase' } })
    expect(await s.readNote('Work/Plan.md')).toBe('plan ✨')
  })

  it('shows the cached tree instantly and works offline', async () => {
    const s1 = await newSession()
    await s1.start()
    await s1.readNote('Inbox.md')
    s1.dispose()

    fake.gh.offline = true
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
    fake.gh.offline = true
    const s = await newSession()
    await s.start()
    expect(useRepo.getState().phase).toBe('error')
  })

  it('refetches only changed blobs on revalidate', async () => {
    const s1 = await newSession()
    await s1.start()
    expect(await s1.prefetchNotes()).toBe(3)
    s1.dispose()

    fake.gh.pushExternal({ 'Home/Food.md': 'more food' })
    fake.gh.log = []
    const s2 = await newSession()
    await s2.start()
    expect(await s2.prefetchNotes()).toBe(1)
    expect(blobGets()).toHaveLength(1)
    expect(await s2.readNote('Home/Food.md')).toBe('more food')
    expect(await s2.readNote('Inbox.md')).toBe('# Inbox')
    expect(blobGets()).toHaveLength(1)
  })
})

describe('RepoSession drafts & auto-save', () => {
  it('batches edits to several notes into one commit', async () => {
    const s = await newSession()
    await s.start()
    await s.editNote('Inbox.md', 'a')
    await s.editNote('Work/Plan.md', 'b')
    expect(useRepo.getState().dirty).toEqual({ 'Inbox.md': true, 'Work/Plan.md': true })
    await vi.waitFor(() => expect(useRepo.getState().saveStatus).toBe('saved'))
    expect(fake.gh.commitCount()).toBe(2)
    expect(fake.gh.files()).toMatchObject({ 'Inbox.md': 'a', 'Work/Plan.md': 'b' })
    expect(useRepo.getState().dirty).toEqual({})
  })

  it('restores and saves drafts after a reload', async () => {
    const s1 = await newSession({ idleMs: 60_000 })
    await s1.start()
    await s1.editNote('Inbox.md', 'unsaved work')
    s1.dispose() // "tab closed" before the debounce fired
    expect(fake.gh.files()['Inbox.md']).toBe('# Inbox')

    const s2 = await newSession()
    await s2.start()
    expect(await s2.readNote('Inbox.md')).toBe('unsaved work')
    await vi.waitFor(() => expect(fake.gh.files()['Inbox.md']).toBe('unsaved work'))
    await vi.waitFor(() => expect(useRepo.getState().dirty).toEqual({}))
  })

  it('creates a conflict copy when a draft is stale', async () => {
    const s1 = await newSession({ idleMs: 60_000 })
    await s1.start()
    await s1.editNote('Inbox.md', 'mine')
    s1.dispose()
    fake.gh.pushExternal({ 'Inbox.md': 'theirs' })

    const s2 = await newSession({ now: () => new Date('2026-10-11T00:00:00Z') })
    await s2.start()
    await vi.waitFor(() => expect(fake.gh.files()['Inbox (conflict 2026-10-11).md']).toBe('mine'))
    expect(fake.gh.files()['Inbox.md']).toBe('theirs')
    expect(useRepo.getState().notices.at(-1)!.message).toContain('Inbox (conflict 2026-10-11).md')
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
    fake.gh.offline = true
    await s.editNote('Inbox.md', 'offline edit')
    await vi.waitFor(() => expect(useRepo.getState().saveStatus).toBe('offline'))
    fake.gh.offline = false
    await s.saver.saveNow()
    expect(useRepo.getState().saveStatus).toBe('saved')
    expect(fake.gh.files()['Inbox.md']).toBe('offline edit')
  })
})

describe('RepoSession optimistic operations', () => {
  it('updates the tree immediately and rolls back on failure', async () => {
    const s = await newSession()
    await s.start()
    let visibleDuringCommit = false
    fake.gh.failNext = (m) => {
      if (m !== 'PATCH') return undefined
      visibleDuringCommit = s.exists('New.md')
      return { status: 500, body: { message: 'boom' } }
    }
    await expect(s.applyOptimistic([{ path: 'New.md', content: '' }], 'Create New.md')).rejects.toThrow()
    expect(visibleDuringCommit).toBe(true)
    expect(s.exists('New.md')).toBe(false)
    expect(useRepo.getState().snapshot!.entries.some((e) => e.path === 'New.md')).toBe(false)
  })
})
