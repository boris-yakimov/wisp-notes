import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { RemoteState } from '../drive/remoteTree.ts'

/** Unsaved local edit of a note. Persisted on every change so nothing is lost on tab close. */
export interface Draft {
  repoKey: string
  path: string
  content: string
  /** Content hash of the file when editing started (null = new file). Used for conflict detection. */
  baseHash: string | null
  updatedAt: number
}

interface WispDB extends DBSchema {
  /** Last known remote Drive state per account (keyed by repoKey). */
  snapshots: { key: string; value: RemoteState & { repoKey: string } }
  /** File contents keyed by MD5. Content-addressed, so never stale. */
  blobs: { key: string; value: { sha: string; content: string } }
  drafts: { key: [string, string]; value: Draft; indexes: { byRepo: string } }
  /** Binary files (images, PDFs) keyed by MD5, for offline viewing. */
  files: { key: string; value: { sha: string; blob: Blob } }
}

export class Cache {
  private db: IDBPDatabase<WispDB>
  private closed = false

  private constructor(db: IDBPDatabase<WispDB>) {
    this.db = db
  }

  static async open(name = 'wisp-notes'): Promise<Cache> {
    const db = await openDB<WispDB>(name, 3, {
      upgrade(db, oldVersion) {
        // v1 held GitHub data: start fresh.
        if (oldVersion < 2) {
          for (const s of [...db.objectStoreNames]) db.deleteObjectStore(s)
          db.createObjectStore('snapshots', { keyPath: 'repoKey' })
          db.createObjectStore('blobs', { keyPath: 'sha' })
          const drafts = db.createObjectStore('drafts', { keyPath: ['repoKey', 'path'] })
          drafts.createIndex('byRepo', 'repoKey')
        }
        if (oldVersion < 3) db.createObjectStore('files', { keyPath: 'sha' })
      },
    })
    return new Cache(db)
  }

  close(): void {
    this.closed = true
    this.db.close()
  }

  /** After close() (teardown) pending operations resolve to a fallback instead of throwing. */
  private async guard<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (this.closed) return fallback
    try {
      return await fn()
    } catch (e) {
      if (this.closed) return fallback
      throw e
    }
  }

  async getSnapshot(repoKey: string): Promise<RemoteState | undefined> {
    const v = await this.guard(() => this.db.get('snapshots', repoKey), undefined)
    if (!v) return undefined
    return { rootId: v.rootId, changeToken: v.changeToken, items: v.items }
  }

  async putSnapshot(repoKey: string, s: RemoteState): Promise<void> {
    const value = { repoKey, rootId: s.rootId, changeToken: s.changeToken, items: s.items }
    await this.guard(() => this.db.put('snapshots', value), '')
  }

  async getBlob(hash: string): Promise<string | undefined> {
    return (await this.guard(() => this.db.get('blobs', hash), undefined))?.content
  }

  async putBlob(hash: string, content: string): Promise<void> {
    await this.guard(() => this.db.put('blobs', { sha: hash, content }), '')
  }

  async getFile(hash: string): Promise<Blob | undefined> {
    return (await this.guard(() => this.db.get('files', hash), undefined))?.blob
  }

  async putFile(hash: string, blob: Blob): Promise<void> {
    await this.guard(() => this.db.put('files', { sha: hash, blob }), '')
  }

  /** Which of the given hashes are already cached. */
  async cachedShas(hashes: string[]): Promise<Set<string>> {
    const keys = new Set<string>(await this.guard(() => this.db.getAllKeys('blobs'), []))
    return new Set(hashes.filter((s) => keys.has(s)))
  }

  async getDrafts(repoKey: string): Promise<Draft[]> {
    return this.guard(() => this.db.getAllFromIndex('drafts', 'byRepo', repoKey), [])
  }

  async putDraft(d: Draft): Promise<void> {
    await this.guard(() => this.db.put('drafts', d), null)
  }

  async deleteDraft(repoKey: string, path: string): Promise<void> {
    await this.guard(() => this.db.delete('drafts', [repoKey, path]), undefined)
  }

  /** Remove everything stored locally (sign out). */
  async clearAll(): Promise<void> {
    await this.guard(async () => {
      const tx = this.db.transaction(['snapshots', 'blobs', 'drafts', 'files'], 'readwrite')
      await Promise.all([
        tx.objectStore('snapshots').clear(),
        tx.objectStore('blobs').clear(),
        tx.objectStore('drafts').clear(),
        tx.objectStore('files').clear(),
        tx.done,
      ])
    }, undefined)
  }
}
