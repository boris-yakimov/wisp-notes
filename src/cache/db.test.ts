import { Cache } from './db.ts'

let n = 0
const open = () => Cache.open(`test-${n++}`)

describe('Cache', () => {
  it('stores snapshots per repo', async () => {
    const c = await open()
    const snap = { commitSha: 'c1', treeSha: 't1', entries: [{ path: 'a.md', sha: 's1' }] }
    await c.putSnapshot('me/notes@main', snap)
    expect(await c.getSnapshot('me/notes@main')).toEqual(snap)
    expect(await c.getSnapshot('me/other@main')).toBeUndefined()
  })

  it('stores blobs by SHA and reports which are cached', async () => {
    const c = await open()
    await c.putBlob('s1', 'héllo 🎉')
    expect(await c.getBlob('s1')).toBe('héllo 🎉')
    expect(await c.cachedShas(['s1', 's2'])).toEqual(new Set(['s1']))
  })

  it('stores drafts per repo and survives reopen', async () => {
    const name = `test-${n++}`
    const c = await Cache.open(name)
    await c.putDraft({ repoKey: 'r', path: 'a.md', content: 'x', baseSha: null, updatedAt: 1 })
    await c.putDraft({ repoKey: 'other', path: 'b.md', content: 'y', baseSha: null, updatedAt: 1 })
    c.close()
    const c2 = await Cache.open(name)
    expect((await c2.getDrafts('r')).map((d) => d.path)).toEqual(['a.md'])
    await c2.deleteDraft('r', 'a.md')
    expect(await c2.getDrafts('r')).toEqual([])
  })
})
