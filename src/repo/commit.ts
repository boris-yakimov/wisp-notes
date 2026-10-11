import type { GitHubClient, Snapshot, TreeWrite } from '../github/client.ts'
import { toGitHubError } from '../github/errors.ts'
import { conflictPath } from './paths.ts'

/** Reference to a blob already in the repo (moves/renames reuse it without re-uploading). */
export interface BlobRef {
  sha: string
}

/** One file change. content=null deletes the file; a BlobRef writes an existing blob. */
export interface Change {
  path: string
  content: string | null | BlobRef
  /**
   * Blob SHA the change was based on (null = file did not exist).
   * Defaults to the SHA in the base snapshot passed to commitChanges.
   */
  baseSha?: string | null
}

export interface ConflictCopy {
  path: string
  copyPath: string
}

export interface CommitResult {
  /** Snapshot after the commit (or the latest head if nothing needed committing). */
  snapshot: Snapshot
  committed: boolean
  conflicts: ConflictCopy[]
  /** Files written by the commit (including conflict copies). */
  written: { path: string; sha: string; content: string }[]
}

export interface CommitOptions {
  now?: () => Date
  maxAttempts?: number
}

const toMap = (entries: Snapshot['entries']) => new Map(entries.map((e) => [e.path, e.sha]))

/**
 * Atomically commit a change set with the Git Data API:
 * blobs → tree (base_tree) → commit → non-forced ref update.
 *
 * If the ref update is rejected because the branch moved, the new head is fetched and,
 * per file: if the remote blob is unchanged since our base the change is re-applied on
 * the new head; otherwise our version is written to `Name (conflict YYYY-MM-DD).md`
 * (remote version is kept). Deletes of remotely-modified files are dropped.
 */
export async function commitChanges(
  client: GitHubClient,
  base: Snapshot,
  changes: Change[],
  message: string,
  opts: CommitOptions = {},
): Promise<CommitResult> {
  const now = opts.now ?? (() => new Date())
  const maxAttempts = opts.maxAttempts ?? 4
  const baseMap = toMap(base.entries)
  const blobCache = new Map<string, string>() // content -> sha
  const blobFor = async (content: string) => {
    let sha = blobCache.get(content)
    if (!sha) {
      sha = await client.createBlob(content)
      blobCache.set(content, sha)
    }
    return sha
  }

  let head = base
  for (let attempt = 0; ; attempt++) {
    const headMap = toMap(head.entries)
    const writes: TreeWrite[] = []
    const written: CommitResult['written'] = []
    const conflicts: ConflictCopy[] = []
    const taken = (p: string) => headMap.has(p) || writes.some((w) => w.path === p)

    for (const c of changes) {
      const expected = c.baseSha !== undefined ? c.baseSha : (baseMap.get(c.path) ?? null)
      const remote = headMap.get(c.path) ?? null
      let target = c.path

      if (c.content === null) {
        // Delete only if the remote file is still the version we saw.
        if (remote !== null && remote === expected) writes.push({ path: c.path, sha: null })
        continue
      }
      const sha = typeof c.content === 'string' ? await blobFor(c.content) : c.content.sha
      if (remote === sha) continue // already identical
      if (remote !== expected && remote !== null) {
        target = conflictPath(c.path, now(), taken)
        conflicts.push({ path: c.path, copyPath: target })
      }
      writes.push({ path: target, sha })
      if (typeof c.content === 'string') written.push({ path: target, sha, content: c.content })
    }

    if (writes.length === 0) return { snapshot: head, committed: false, conflicts, written }

    const tree = await client.createTree(head.treeSha, writes)
    const commit = await client.createCommit(message, tree, head.commitSha)
    try {
      await client.updateRef(commit)
    } catch (e) {
      const err = toGitHubError(e)
      if (err.kind === 'conflict' && attempt + 1 < maxAttempts) {
        head = await client.getSnapshot()
        continue
      }
      throw err
    }
    for (const w of writes) {
      if (w.sha === null) headMap.delete(w.path)
      else headMap.set(w.path, w.sha)
    }
    const entries = [...headMap].map(([path, sha]) => ({ path, sha }))
    return { snapshot: { commitSha: commit, treeSha: tree, entries }, committed: true, conflicts, written }
  }
}

/** Short human commit message for a set of paths. */
export function describeChanges(verb: string, paths: string[]): string {
  if (paths.length === 1) return `${verb} ${paths[0]}`
  return `${verb} ${paths.length} notes\n\n${paths.map((p) => `- ${p}`).join('\n')}`
}
