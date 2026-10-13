import { Cache } from './db.ts'

let n = 0
const open = () => Cache.open(`test-${n++}`)

describe('Cache', () => {
  it('stores remote state per account', async () => {
    const c = await open()
    const state = {
      rootId: 'r',
      changeToken: '5',
      items: [{ id: 'a', name: 'a.md', parentId: 'r', folder: false, md5: 'h', version: '1' }],
    }
    await c.putSnapshot('gdrive:me@example.com', state)
    expect(await c.getSnapshot('gdrive:me@example.com')).toEqual(state)
    expect(await c.getSnapshot('gdrive:other@example.com')).toBeUndefined()
  })

  it('stores blobs by hash and reports which are cached', async () => {
    const c = await open()
    await c.putBlob('h1', 'héllo 🎉')
    expect(await c.getBlob('h1')).toBe('héllo 🎉')
    expect(await c.cachedShas(['h1', 'h2'])).toEqual(new Set(['h1']))
  })

  it('stores drafts per account, survives reopen, and clears everything', async () => {
    const name = `test-${n++}`
    const c = await Cache.open(name)
    await c.putDraft({ repoKey: 'r', path: 'a.md', content: 'x', baseHash: null, updatedAt: 1 })
    await c.putDraft({ repoKey: 'other', path: 'b.md', content: 'y', baseHash: null, updatedAt: 1 })
    c.close()
    const c2 = await Cache.open(name)
    expect((await c2.getDrafts('r')).map((d) => d.path)).toEqual(['a.md'])
    await c2.deleteDraft('r', 'a.md')
    expect(await c2.getDrafts('r')).toEqual([])
    await c2.putBlob('h', 'x')
    await c2.clearAll()
    expect(await c2.getDrafts('other')).toEqual([])
    expect(await c2.getBlob('h')).toBeUndefined()
  })
})
