import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Snapshot } from '../github/client.ts'

/** Unsaved local edit of a note. Persisted on every change so nothing is lost on tab close. */
export interface Draft {
  repoKey: string
  path: string
  content: string
  /** Blob SHA of the file when editing started (null = new file). Used for conflict detection. */
  baseSha: string | null
  updatedAt: number
}

interface WispDB extends DBSchema {
  /** Last known remote snapshot per repo (keyed by repoKey). */
  snapshots: { key: string; value: Snapshot & { repoKey: string } }
  /** Blob contents keyed by SHA. Content-addressed, so never stale. */
  blobs: { key: string; value: { sha: string; content: string } }
  drafts: { key: [string, string]; value: Draft; indexes: { byRepo: string } }
}

export class Cache {
  private db: IDBPDatabase<WispDB>
  private constructor(db: IDBPDatabase<WispDB>) {
    this.db = db
  }

  static async open(name = 'wisp-notes'): Promise<Cache> {
    const db = await openDB<WispDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore('snapshots', { keyPath: 'repoKey' })
        db.createObjectStore('blobs', { keyPath: 'sha' })
        const drafts = db.createObjectStore('drafts', { keyPath: ['repoKey', 'path'] })
        drafts.createIndex('byRepo', 'repoKey')
      },
    })
    return new Cache(db)
  }

  private closed = false

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

  async getSnapshot(repoKey: string): Promise<Snapshot | undefined> {
    const v = await this.guard(() => this.db.get('snapshots', repoKey), undefined)
    if (!v) return undefined
    return { commitSha: v.commitSha, treeSha: v.treeSha, entries: v.entries }
  }

  async putSnapshot(repoKey: string, s: Snapshot): Promise<void> {
    const value = { repoKey, commitSha: s.commitSha, treeSha: s.treeSha, entries: s.entries }
    await this.guard(() => this.db.put('snapshots', value), '')
  }

  async getBlob(sha: string): Promise<string | undefined> {
    return (await this.guard(() => this.db.get('blobs', sha), undefined))?.content
  }

  async putBlob(sha: string, content: string): Promise<void> {
    await this.guard(() => this.db.put('blobs', { sha, content }), '')
  }

  /** Which of the given SHAs are already cached. */
  async cachedShas(shas: string[]): Promise<Set<string>> {
    const keys = new Set<string>(await this.guard(() => this.db.getAllKeys('blobs'), []))
    return new Set(shas.filter((s) => keys.has(s)))
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
}
