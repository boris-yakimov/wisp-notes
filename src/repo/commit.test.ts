import { GitHubClient } from '../github/client.ts'
import { setupFakeGitHub } from '../test/msw.ts'
import { gitSha } from '../test/fakeGitHub.ts'
import { commitChanges } from './commit.ts'

const fake = setupFakeGitHub({ files: { 'a.md': 'alpha', 'Work/b.md': 'beta', 'Work/_meta.json': '{}' } })
const client = () => new GitHubClient({ token: 'good-token', owner: 'me', repo: 'notes', branch: 'main' })
const now = () => new Date('2026-10-11T12:00:00Z')

describe('commitChanges', () => {
  it('commits a single file change', async () => {
    const c = client()
    const base = await c.getSnapshot()
    const res = await commitChanges(c, base, [{ path: 'a.md', content: 'alpha 2 🎉' }], 'Update a.md')
    expect(res.committed).toBe(true)
    expect(fake.gh.files()['a.md']).toBe('alpha 2 🎉')
    expect(fake.gh.commitCount()).toBe(2)
    expect(fake.gh.headCommit()!.message).toBe('Update a.md')
    expect(res.snapshot.commitSha).toBe(fake.gh.headCommit()!.sha)
    expect(res.snapshot.entries.find((e) => e.path === 'a.md')!.sha).toBe(gitSha('alpha 2 🎉'))
  })

  it('commits multiple files atomically in one commit', async () => {
    const c = client()
    const base = await c.getSnapshot()
    await commitChanges(
      c,
      base,
      [
        { path: 'a.md', content: 'A' },
        { path: 'Work/b.md', content: 'B' },
        { path: 'New/c.md', content: 'C' },
      ],
      'batch',
    )
    expect(fake.gh.commitCount()).toBe(2)
    expect(fake.gh.files()).toMatchObject({ 'a.md': 'A', 'Work/b.md': 'B', 'New/c.md': 'C' })
  })

  it('deletes files with null content', async () => {
    const c = client()
    const base = await c.getSnapshot()
    const res = await commitChanges(
      c,
      base,
      [
        { path: 'Work/b.md', content: null },
        { path: 'Work/_meta.json', content: null },
      ],
      'delete',
    )
    expect(Object.keys(fake.gh.files())).toEqual(['a.md'])
    expect(res.snapshot.entries.map((e) => e.path)).toEqual(['a.md'])
  })

  it('skips the commit when nothing changed', async () => {
    const c = client()
    const base = await c.getSnapshot()
    const res = await commitChanges(c, base, [{ path: 'a.md', content: 'alpha' }], 'noop')
    expect(res.committed).toBe(false)
    expect(fake.gh.commitCount()).toBe(1)
  })

  it('rebases onto a moved branch when the edited file is unchanged remotely', async () => {
    const c = client()
    const base = await c.getSnapshot()
    fake.gh.pushExternal({ 'Work/b.md': 'beta from phone' })
    const res = await commitChanges(c, base, [{ path: 'a.md', content: 'mine' }], 'edit', { now })
    expect(res.conflicts).toEqual([])
    expect(fake.gh.files()).toMatchObject({ 'a.md': 'mine', 'Work/b.md': 'beta from phone' })
    expect(fake.gh.commitCount()).toBe(3)
    expect(fake.gh.log.filter((l) => l.method === 'PATCH')).toHaveLength(2)
  })

  it('writes a conflict copy when the edited file changed remotely', async () => {
    const c = client()
    const base = await c.getSnapshot()
    fake.gh.pushExternal({ 'a.md': 'theirs' })
    const res = await commitChanges(c, base, [{ path: 'a.md', content: 'mine' }], 'edit', { now })
    expect(res.conflicts).toEqual([{ path: 'a.md', copyPath: 'a (conflict 2026-10-11).md' }])
    expect(fake.gh.files()).toMatchObject({ 'a.md': 'theirs', 'a (conflict 2026-10-11).md': 'mine' })
  })

  it('detects conflicts from an explicit stale baseSha even without a ref race', async () => {
    const c = client()
    const oldSha = (await c.getSnapshot()).entries.find((e) => e.path === 'a.md')!.sha
    fake.gh.pushExternal({ 'a.md': 'theirs' })
    const base = await c.getSnapshot()
    const res = await commitChanges(c, base, [{ path: 'a.md', content: 'mine', baseSha: oldSha }], 'edit', {
      now,
    })
    expect(res.conflicts).toHaveLength(1)
    expect(fake.gh.files()['a.md']).toBe('theirs')
  })

  it('does not delete a file that was modified remotely', async () => {
    const c = client()
    const base = await c.getSnapshot()
    fake.gh.pushExternal({ 'a.md': 'theirs' })
    await commitChanges(c, base, [{ path: 'a.md', content: null }], 'delete', { now })
    expect(fake.gh.files()['a.md']).toBe('theirs')
  })

  it('propagates network errors', async () => {
    const c = client()
    const base = await c.getSnapshot()
    fake.gh.offline = true
    await expect(commitChanges(c, base, [{ path: 'a.md', content: 'x' }], 'm')).rejects.toMatchObject({
      kind: 'network',
    })
  })
})
