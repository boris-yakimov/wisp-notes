import type { Content, DriveClient } from '../drive/client.ts'
import { DriveError } from '../drive/errors.ts'
import { EMPTY_MD5, md5Hex } from '../drive/md5.ts'
import type { Entry, RemoteTree } from '../drive/remoteTree.ts'
import { basename, conflictPath, dirname, isInside } from './paths.ts'

/**
 * Storage operations on paths. Executed against Drive by `executeOps`, and applied to the
 * UI's entry list immediately (optimistic UI) by `applyOpsToEntries`.
 */
export type DriveOp =
  | {
      kind: 'write'
      path: string
      content: Content
      /**
       * Content hash the edit is based on: null = we believe the file is new; undefined = overwrite
       * without a conflict check. If the remote file differs from `base`, our version is written to a
       * conflict copy instead.
       */
      base?: string | null
    }
  | { kind: 'mkdir'; path: string }
  | { kind: 'rename'; path: string; to: string }
  | { kind: 'trash'; path: string }

export interface ConflictCopy {
  path: string
  copyPath: string
}

export interface ExecResult {
  conflicts: ConflictCopy[]
  /** Text files written (path after conflict handling, content hash, content). */
  written: { path: string; md5: string; content: string }[]
  /** Paths of write ops that succeeded (original op path). */
  saved: string[]
  /** First failure, if any. Ops after a failed structural op are not run. */
  error?: unknown
}

export interface ExecOptions {
  now?: () => Date
  concurrency?: number
  onProgress?: (done: number, total: number) => void
}

/**
 * Is it safe to overwrite a remote file with hash `remote`, given the hash our edit started from?
 * Overwriting an empty file is always safe (e.g. a note edited while it was still being created).
 */
const sameContent = (remote: string | undefined, base: string | null | undefined) =>
  remote === base || remote === EMPTY_MD5 || remote === undefined

/**
 * Execute ops against Drive, updating `tree` in place with the results.
 * Structural ops (mkdir/rename/trash) run in order; consecutive writes run in parallel.
 * Never throws for op failures: returns them in `error` so callers can keep partial progress.
 */
export async function executeOps(
  client: DriveClient,
  tree: RemoteTree,
  ops: DriveOp[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const now = opts.now ?? (() => new Date())
  const result: ExecResult = { conflicts: [], written: [], saved: [] }
  const folderJobs = new Map<string, Promise<string>>()
  let done = 0
  const progress = () => opts.onProgress?.(++done, ops.length)

  /** mkdir -p; returns the folder's Drive ID. Concurrent calls for the same path share one request. */
  const ensureFolder = (path: string): Promise<string> => {
    const existing = tree.folderId(path)
    if (existing) return Promise.resolve(existing)
    if (tree.entry(path))
      return Promise.reject(new DriveError('unknown', `"${path}" is a file, not a folder.`))
    let job = folderJobs.get(path)
    if (!job) {
      job = (async () => {
        const parent = await ensureFolder(dirname(path))
        const item = await client.createFolder(basename(path), parent)
        tree.upsert(item)
        return item.id
      })()
      folderJobs.set(path, job)
      job.catch(() => folderJobs.delete(path))
    }
    return job
  }

  const write = async (op: Extract<DriveOp, { kind: 'write' }>) => {
    const text = typeof op.content === 'string' ? op.content : null
    const md5 = text !== null ? md5Hex(text) : undefined
    const existing = tree.entry(op.path)
    let target = op.path
    if (existing && !existing.folder) {
      if (md5 && existing.md5 === md5) {
        result.saved.push(op.path)
        return
      }
      if (op.base === undefined || sameContent(existing.md5, op.base)) {
        const item = await client.updateContent(existing.id, basename(op.path), op.content)
        tree.upsert(item)
        if (text !== null) result.written.push({ path: op.path, md5: item.md5 ?? md5!, content: text })
        result.saved.push(op.path)
        return
      }
      // Changed elsewhere since we loaded it: keep theirs, save ours next to it.
      target = conflictPath(op.path, now(), (p) => !!tree.entry(p))
      result.conflicts.push({ path: op.path, copyPath: target })
    } else if (existing?.folder) {
      target = conflictPath(op.path, now(), (p) => !!tree.entry(p))
      result.conflicts.push({ path: op.path, copyPath: target })
    }
    const parent = await ensureFolder(dirname(target))
    const item = await client.createFile(basename(target), parent, op.content)
    tree.upsert(item)
    if (text !== null) result.written.push({ path: target, md5: item.md5 ?? md5!, content: text })
    result.saved.push(op.path)
  }

  const structural = async (op: Exclude<DriveOp, { kind: 'write' }>) => {
    if (op.kind === 'mkdir') {
      await ensureFolder(op.path)
      return
    }
    const e = tree.entry(op.path)
    if (!e) throw new DriveError('not-found', `"${basename(op.path)}" no longer exists.`)
    if (op.kind === 'trash') {
      await client.trash(e.id)
      tree.remove(e.id)
      return
    }
    const from = dirname(op.path)
    const to = dirname(op.to)
    const toId = from === to ? undefined : await ensureFolder(to)
    const item = await client.update(e.id, {
      name: basename(op.to),
      ...(toId ? { from: tree.folderId(from), to: toId } : {}),
    })
    tree.upsert(item)
  }

  const limit = Math.max(1, opts.concurrency ?? 4)
  for (let i = 0; i < ops.length;) {
    const op = ops[i]!
    if (op.kind !== 'write') {
      try {
        await structural(op)
        progress()
      } catch (e) {
        result.error = e
        return result
      }
      i++
      continue
    }
    // A run of consecutive writes: parallel with limited concurrency; failures don't stop the others.
    let j = i
    while (j < ops.length && ops[j]!.kind === 'write') j++
    const batch = ops.slice(i, j) as Extract<DriveOp, { kind: 'write' }>[]
    let next = 0
    const worker = async () => {
      while (next < batch.length) {
        const w = batch[next++]!
        try {
          await write(w)
        } catch (e) {
          result.error ??= e
        }
        progress()
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, batch.length) }, worker))
    i = j
  }
  return result
}

/** Apply ops to a path list immediately (optimistic UI). New items get temporary IDs. */
export function applyOpsToEntries(entries: Entry[], ops: DriveOp[]): Entry[] {
  let list = entries.slice()
  let tmp = 0
  const has = (p: string) => list.some((e) => e.path === p)
  const mkdirP = (path: string) => {
    for (let d = path; d && !has(d); d = dirname(d))
      list.push({ path: d, id: `pending:${tmp++}`, folder: true })
  }
  for (const op of ops) {
    switch (op.kind) {
      case 'write': {
        mkdirP(dirname(op.path))
        const md5 = typeof op.content === 'string' ? md5Hex(op.content) : undefined
        const i = list.findIndex((e) => e.path === op.path)
        const e: Entry = {
          path: op.path,
          id: i >= 0 ? list[i]!.id : `pending:${tmp++}`,
          folder: false,
          ...(md5 ? { md5 } : {}),
        }
        if (i >= 0) list[i] = e
        else list.push(e)
        break
      }
      case 'mkdir':
        mkdirP(op.path)
        break
      case 'trash':
        list = list.filter((e) => !isInside(e.path, op.path))
        break
      case 'rename':
        mkdirP(dirname(op.to))
        list = list.map((e) =>
          isInside(e.path, op.path) ? { ...e, path: op.to + e.path.slice(op.path.length) } : e,
        )
        break
    }
  }
  return list
}
