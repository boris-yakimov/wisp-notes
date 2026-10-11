import { Octokit } from '@octokit/rest'
import { base64ToUtf8, utf8ToBase64 } from './base64.ts'
import { GitHubError, toGitHubError } from './errors.ts'

/** A file (blob) in the repo tree. Folders are implicit from paths. */
export interface TreeEntry {
  path: string
  sha: string
}

/** Repo state at a specific commit. */
export interface Snapshot {
  commitSha: string
  treeSha: string
  entries: TreeEntry[]
}

/** Entry for createTree: sha=null deletes the path. */
export interface TreeWrite {
  path: string
  sha: string | null
}

export interface RepoInfo {
  fullName: string
  canPush: boolean
  defaultBranch: string
}

export interface ClientConfig {
  token: string
  owner: string
  repo: string
  branch: string
}

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

/** Thin, typed wrapper over Octokit for the endpoints Wisp Notes uses. */
export class GitHubClient {
  readonly owner: string
  readonly repo: string
  readonly branch: string
  private octokit: Octokit

  constructor(cfg: ClientConfig) {
    this.owner = cfg.owner
    this.repo = cfg.repo
    this.branch = cfg.branch
    this.octokit = new Octokit({ auth: cfg.token, log: silentLog, request: { retries: 0 } })
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw toGitHubError(e)
    }
  }

  private get r() {
    return { owner: this.owner, repo: this.repo }
  }

  async getRepo(): Promise<RepoInfo> {
    const { data } = await this.call(() => this.octokit.repos.get(this.r))
    return {
      fullName: data.full_name,
      canPush: data.permissions?.push ?? false,
      defaultBranch: data.default_branch,
    }
  }

  /** Head commit + root tree SHA of the branch. Throws not-found if missing. */
  async getHead(): Promise<{ commitSha: string; treeSha: string }> {
    const { data } = await this.call(() => this.octokit.repos.getBranch({ ...this.r, branch: this.branch }))
    return { commitSha: data.commit.sha, treeSha: data.commit.commit.tree.sha }
  }

  /** Full snapshot of the branch: one request for head, one for the recursive tree. */
  async getSnapshot(): Promise<Snapshot> {
    const head = await this.getHead()
    const entries = await this.getTreeEntries(head.treeSha)
    return { ...head, entries }
  }

  async getTreeEntries(treeSha: string): Promise<TreeEntry[]> {
    const { data } = await this.call(() =>
      this.octokit.git.getTree({ ...this.r, tree_sha: treeSha, recursive: 'true' }),
    )
    if (data.truncated) console.warn('[wisp] repository tree truncated by GitHub; some files are hidden')
    return data.tree
      .filter((e) => e.type === 'blob' && e.path && e.sha)
      .map((e) => ({ path: e.path!, sha: e.sha! }))
  }

  async getBlob(sha: string): Promise<string> {
    const { data } = await this.call(() => this.octokit.git.getBlob({ ...this.r, file_sha: sha }))
    if (data.encoding !== 'base64') throw new GitHubError('unknown', `Unexpected encoding ${data.encoding}`)
    return base64ToUtf8(data.content)
  }

  async createBlob(content: string): Promise<string> {
    const { data } = await this.call(() =>
      this.octokit.git.createBlob({ ...this.r, content: utf8ToBase64(content), encoding: 'base64' }),
    )
    return data.sha
  }

  async createTree(baseTree: string, writes: TreeWrite[]): Promise<string> {
    const { data } = await this.call(() =>
      this.octokit.git.createTree({
        ...this.r,
        base_tree: baseTree,
        tree: writes.map((w) => ({
          path: w.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: w.sha,
        })),
      }),
    )
    return data.sha
  }

  async createCommit(message: string, tree: string, parent: string): Promise<string> {
    const { data } = await this.call(() =>
      this.octokit.git.createCommit({ ...this.r, message, tree, parents: [parent] }),
    )
    return data.sha
  }

  /** Non-forced ref update; throws GitHubError('conflict') if the branch moved. */
  async updateRef(commitSha: string): Promise<void> {
    await this.call(() =>
      this.octokit.git.updateRef({ ...this.r, ref: `heads/${this.branch}`, sha: commitSha, force: false }),
    )
  }

  /** Create the first commit in an empty repository (Git Data API can't do that). */
  async initializeEmptyRepo(): Promise<void> {
    await this.call(() =>
      this.octokit.repos.createOrUpdateFileContents({
        ...this.r,
        path: 'README.md',
        branch: this.branch,
        message: 'Initialize Wisp Notes',
        content: utf8ToBase64('# Notes\n\nManaged with Wisp Notes.\n'),
      }),
    )
  }
}

export type ConnectionResult =
  { ok: true; fullName: string } | { ok: false; kind: GitHubError['kind'] | 'read-only'; message: string }

/** Validate token, repo access, write permission and branch. */
export async function validateConnection(client: GitHubClient): Promise<ConnectionResult> {
  try {
    const info = await client.getRepo()
    if (!info.canPush) {
      return {
        ok: false,
        kind: 'read-only',
        message: 'The token can read but not write this repository. Grant "Contents: Read and write".',
      }
    }
    try {
      await client.getHead()
    } catch (e) {
      const err = toGitHubError(e)
      if (err.kind === 'not-found') {
        // A brand-new repo has no branches at all.
        try {
          await client.getTreeEntries(client.branch)
        } catch (e2) {
          if (toGitHubError(e2).kind === 'empty-repo') {
            return { ok: false, kind: 'empty-repo', message: 'The repository is empty.' }
          }
        }
        return { ok: false, kind: 'not-found', message: `Branch "${client.branch}" not found.` }
      }
      throw err
    }
    return { ok: true, fullName: info.fullName }
  } catch (e) {
    const err = toGitHubError(e)
    return { ok: false, kind: err.kind, message: err.message }
  }
}
