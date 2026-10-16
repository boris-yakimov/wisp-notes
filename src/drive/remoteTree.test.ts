import type { DriveItem } from './client.ts'
import { RemoteTree } from './remoteTree.ts'

const item = (id: string, name: string, parentId: string, version: string): DriveItem => ({
  id,
  name,
  parentId,
  folder: false,
  version,
})

describe('RemoteTree.applyChanges', () => {
  it('ignores a stale change that is older than the item we have', () => {
    const tree = new RemoteTree({
      rootId: 'r',
      changeToken: '1',
      items: [{ id: 'w', name: 'Work', parentId: 'r', folder: true, version: '1' }],
    })
    tree.upsert(item('a', 'Plan.md', 'w', '10')) // our own move, confirmed by Drive
    tree.applyChanges([{ fileId: 'a', item: item('a', 'Plan.md', 'r', '9') }]) // lagging feed
    expect(tree.entry('Work/Plan.md')).toBeDefined()
    expect(tree.entry('Plan.md')).toBeUndefined()

    tree.applyChanges([{ fileId: 'a', item: item('a', 'Renamed.md', 'w', '11') }])
    expect(tree.entry('Work/Renamed.md')).toBeDefined()
  })
})
