import { encodeName, NAME_SLASH } from '../repo/paths.ts'
import type { DriveChange, DriveItem } from './client.ts'

/** Path-based view of one item, as used by the UI. Paths are relative to the Wisp Notes root folder. */
export interface Entry {
  path: string
  id: string
  folder: boolean
  /** Content hash (files only). Changes whenever the content changes. */
  md5?: string
}

/** Serializable remote state. */
export interface RemoteState {
  rootId: string
  /** Drive changes-feed token; null until the first full listing. */
  changeToken: string | null
  items: DriveItem[]
}

/**
 * Remote Drive state keyed by file ID, with paths derived from the parent chain.
 * Items not reachable from the root folder are ignored. A "/" in a name is stored as `NAME_SLASH`
 * in its path segment (see paths.ts);
 * duplicate names in one folder get a " (2)" suffix in the derived path.
 */
export class RemoteTree {
  readonly rootId: string
  changeToken: string | null
  private items: Map<string, DriveItem>
  private derived: { entries: Entry[]; byPath: Map<string, Entry> } | null = null

  constructor(state: RemoteState) {
    this.rootId = state.rootId
    this.changeToken = state.changeToken
    this.items = new Map(state.items.filter((i) => i.id !== state.rootId).map((i) => [i.id, i]))
  }

  clone(): RemoteTree {
    return new RemoteTree(this.toState())
  }

  toState(): RemoteState {
    return { rootId: this.rootId, changeToken: this.changeToken, items: [...this.items.values()] }
  }

  upsert(item: DriveItem): void {
    if (item.id === this.rootId) return
    this.items.set(item.id, item)
    this.derived = null
  }

  /** Remove an item and everything below it. */
  remove(id: string): void {
    if (!this.items.delete(id)) return
    for (const child of [...this.items.values()]) if (child.parentId === id) this.remove(child.id)
    this.derived = null
  }

  applyChanges(changes: DriveChange[]): void {
    for (const c of changes) {
      if (c.item) this.upsert(c.item)
      else this.remove(c.fileId)
    }
  }

  get(id: string): DriveItem | undefined {
    return this.items.get(id)
  }

  private derive() {
    if (this.derived) return this.derived
    const children = new Map<string, DriveItem[]>()
    for (const i of this.items.values()) {
      if (!i.parentId) continue
      let list = children.get(i.parentId)
      if (!list) children.set(i.parentId, (list = []))
      list.push(i)
    }
    const entries: Entry[] = []
    const byPath = new Map<string, Entry>()
    const walk = (folderId: string, prefix: string, depth: number) => {
      if (depth > 64) return // guard against cycles
      const list = (children.get(folderId) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id))
      const used = new Set<string>()
      for (const i of list) {
        if (!i.name || i.name.includes(NAME_SLASH)) continue
        const base = encodeName(i.name)
        let name = base
        for (let n = 2; used.has(name.toLowerCase()); n++) {
          const dot = base.lastIndexOf('.')
          name = !i.folder && dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`
        }
        used.add(name.toLowerCase())
        const path = prefix ? `${prefix}/${name}` : name
        const e: Entry = { path, id: i.id, folder: i.folder, ...(i.md5 ? { md5: i.md5 } : {}) }
        entries.push(e)
        byPath.set(path, e)
        if (i.folder) walk(i.id, path, depth + 1)
      }
    }
    walk(this.rootId, '', 0)
    this.derived = { entries, byPath }
    return this.derived
  }

  entries(): Entry[] {
    return this.derive().entries
  }

  entry(path: string): Entry | undefined {
    return this.derive().byPath.get(path)
  }

  /** Drive ID of a folder path ('' = root). */
  folderId(path: string): string | undefined {
    if (path === '') return this.rootId
    const e = this.entry(path)
    return e?.folder ? e.id : undefined
  }
}
