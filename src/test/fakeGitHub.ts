import { createHash } from 'node:crypto'

/**
 * In-memory fake of the subset of the GitHub REST API used by Wisp Notes.
 * Framework-agnostic: adapted to MSW (unit tests, see msw.ts) and to
 * Playwright's page.route (E2E, see e2e/fixtures.ts).
 *
 * Supports: repo info, branches, recursive trees, blobs, Git Data API writes
 * (blobs → tree → commit → ref) and Contents API PUT (only used to initialize
 * an empty repository).
 */

export interface FakeResponse {
  status: number
  body: unknown
}

interface Commit {
  sha: string
  tree: string
  parents: string[]
  message: string
}

type Tree = Map<string, string> // path -> blob sha (flat; only blobs)

export interface FakeGitHubOptions {
  owner?: string
  repo?: string
  branch?: string
  token?: string
  files?: Record<string, string>
  /** Value of `permissions.push` in GET /repos response. */
  canPush?: boolean
  /** Start with an empty repository (no commits). */
  empty?: boolean
}

/** Real git blob SHA-1, so client-side gitBlobSha() matches. */
export function gitSha(content: string): string {
  const body = Buffer.from(content, 'utf8')
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')
}

/** Deterministic 40-hex content hash (not real SHA-1, but content-addressed). */
export function fakeSha(input: string): string {
  let out = ''
  for (let seed = 0; out.length < 40; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b1)
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return out.slice(0, 40)
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export class FakeGitHub {
  owner: string
  repo: string
  branch: string
  token: string
  canPush: boolean
  blobs = new Map<string, string>() // sha -> content
  trees = new Map<string, Tree>()
  commits = new Map<string, Commit>()
  refs = new Map<string, string>() // branch -> commit sha
  /** Every handled request, for assertions. */
  log: { method: string; path: string }[] = []
  /** When true every request fails like a network error would. */
  offline = false
  /** Inject a one-shot failure for the next request matching the predicate. */
  failNext: ((method: string, path: string) => FakeResponse | undefined) | undefined

  constructor(opts: FakeGitHubOptions = {}) {
    this.owner = opts.owner ?? 'me'
    this.repo = opts.repo ?? 'notes'
    this.branch = opts.branch ?? 'main'
    this.token = opts.token ?? 'good-token'
    this.canPush = opts.canPush ?? true
    if (!opts.empty) this.seed(opts.files ?? {})
  }

  private seed(files: Record<string, string>) {
    const tree: Tree = new Map()
    for (const [path, content] of Object.entries(files)) tree.set(path, this.putBlob(content))
    this.commitTree(tree, 'initial', [])
  }

  putBlob(content: string): string {
    const sha = gitSha(content)
    this.blobs.set(sha, content)
    return sha
  }

  private putTree(tree: Tree): string {
    const sha = fakeSha('tree:' + [...tree].sort().join('\n'))
    this.trees.set(sha, tree)
    return sha
  }

  private commitTree(tree: Tree, message: string, parents: string[]): string {
    const treeSha = this.putTree(tree)
    const sha = fakeSha(`commit:${treeSha}:${parents.join(',')}:${message}:${this.commits.size}`)
    this.commits.set(sha, { sha, tree: treeSha, parents, message })
    this.refs.set(this.branch, sha)
    return sha
  }

  /** Simulate another device pushing a commit. */
  pushExternal(changes: Record<string, string | null>, message = 'external'): string {
    const head = this.headTree()
    const tree: Tree = new Map(head)
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) tree.delete(path)
      else tree.set(path, this.putBlob(content))
    }
    const parent = this.refs.get(this.branch)
    return this.commitTree(tree, message, parent ? [parent] : [])
  }

  headTree(): Tree {
    const head = this.refs.get(this.branch)
    if (!head) return new Map()
    return this.trees.get(this.commits.get(head)!.tree)!
  }

  /** Current files at branch head: path -> content. */
  files(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [path, sha] of this.headTree()) out[path] = this.blobs.get(sha)!
    return out
  }

  headCommit(): Commit | undefined {
    const head = this.refs.get(this.branch)
    return head ? this.commits.get(head) : undefined
  }

  /** Number of commits reachable from head (including initial). */
  commitCount(): number {
    let n = 0
    let c = this.headCommit()
    while (c) {
      n++
      c = c.parents[0] ? this.commits.get(c.parents[0]) : undefined
    }
    return n
  }

  handle(method: string, url: string, headers: Record<string, string>, body: unknown): FakeResponse {
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname)
    this.log.push({ method, path })
    if (this.offline) throw new TypeError('Failed to fetch')
    const injected = this.failNext?.(method, path)
    if (injected) {
      this.failNext = undefined
      return injected
    }
    const auth = headers['authorization'] ?? ''
    if (auth !== `token ${this.token}` && auth !== `Bearer ${this.token}`) {
      return { status: 401, body: { message: 'Bad credentials' } }
    }
    const prefix = `/repos/${this.owner}/${this.repo}`
    if (!path.startsWith(prefix + '/') && path !== prefix) {
      return { status: 404, body: { message: 'Not Found' } }
    }
    const rest = path.slice(prefix.length)
    const b = (body ?? {}) as Record<string, unknown>

    if (method === 'GET' && rest === '') {
      return {
        status: 200,
        body: {
          full_name: `${this.owner}/${this.repo}`,
          private: true,
          default_branch: this.branch,
          size: this.refs.size ? 1 : 0,
          permissions: { admin: false, push: this.canPush, pull: true },
        },
      }
    }

    let m: RegExpMatchArray | null
    if (method === 'GET' && (m = rest.match(/^\/branches\/(.+)$/))) {
      const sha = this.refs.get(m[1]!)
      if (!sha) {
        if (!this.refs.size) return { status: 404, body: { message: 'Branch not found' } }
        return { status: 404, body: { message: 'Branch not found' } }
      }
      const c = this.commits.get(sha)!
      return { status: 200, body: { name: m[1], commit: { sha, commit: { tree: { sha: c.tree } } } } }
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/trees\/(.+)$/))) {
      if (!this.refs.size) return { status: 409, body: { message: 'Git Repository is empty.' } }
      const tree = this.trees.get(m[1]!)
      if (!tree) return { status: 404, body: { message: 'Not Found' } }
      const entries: { path: string; type: string; sha: string; mode: string }[] = []
      const dirs = new Set<string>()
      for (const [p, sha] of tree) {
        entries.push({ path: p, type: 'blob', sha, mode: '100644' })
        const parts = p.split('/')
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
      }
      for (const d of dirs) entries.push({ path: d, type: 'tree', sha: fakeSha('dir:' + d), mode: '040000' })
      return { status: 200, body: { sha: m[1], tree: entries, truncated: false } }
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/blobs\/(.+)$/))) {
      const content = this.blobs.get(m[1]!)
      if (content === undefined) return { status: 404, body: { message: 'Not Found' } }
      return { status: 200, body: { sha: m[1], encoding: 'base64', content: toBase64(content) } }
    }
    if (method === 'GET' && (m = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = this.refs.get(m[1]!)
      if (!sha) return { status: 404, body: { message: 'Not Found' } }
      return { status: 200, body: { ref: `refs/heads/${m[1]}`, object: { sha, type: 'commit' } } }
    }

    if (!this.canPush && method !== 'GET') {
      return { status: 403, body: { message: 'Resource not accessible by personal access token' } }
    }

    if (method === 'POST' && rest === '/git/blobs') {
      const content = b.encoding === 'base64' ? fromBase64(String(b.content)) : String(b.content)
      return { status: 201, body: { sha: this.putBlob(content) } }
    }
    if (method === 'POST' && rest === '/git/trees') {
      const base = b.base_tree ? this.trees.get(String(b.base_tree)) : new Map<string, string>()
      if (!base) return { status: 422, body: { message: 'Invalid base_tree' } }
      const tree: Tree = new Map(base)
      for (const e of (b.tree as { path: string; sha: string | null; content?: string }[]) ?? []) {
        if (e.sha === null) {
          if (!tree.has(e.path)) return { status: 422, body: { message: `path ${e.path} not in tree` } }
          tree.delete(e.path)
        } else if (e.content !== undefined) {
          tree.set(e.path, this.putBlob(e.content))
        } else {
          if (!this.blobs.has(e.sha)) return { status: 422, body: { message: 'Invalid sha' } }
          tree.set(e.path, e.sha)
        }
      }
      return { status: 201, body: { sha: this.putTree(tree) } }
    }
    if (method === 'POST' && rest === '/git/commits') {
      const treeSha = String(b.tree)
      if (!this.trees.has(treeSha)) return { status: 422, body: { message: 'Invalid tree' } }
      const parents = (b.parents as string[]) ?? []
      const sha = fakeSha(`commit:${treeSha}:${parents.join(',')}:${b.message}:${this.commits.size}`)
      this.commits.set(sha, { sha, tree: treeSha, parents, message: String(b.message) })
      return { status: 201, body: { sha, tree: { sha: treeSha } } }
    }
    if (method === 'PATCH' && (m = rest.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const branch = m[1]!
      const current = this.refs.get(branch)
      const next = String(b.sha)
      const commit = this.commits.get(next)
      if (!commit) return { status: 422, body: { message: 'Object does not exist' } }
      if (!b.force && current && commit.parents[0] !== current) {
        return { status: 422, body: { message: 'Update is not a fast forward' } }
      }
      this.refs.set(branch, next)
      return { status: 200, body: { ref: `refs/heads/${branch}`, object: { sha: next } } }
    }
    if (method === 'PUT' && (m = rest.match(/^\/contents\/(.+)$/))) {
      const content = fromBase64(String(b.content))
      const tree: Tree = new Map(this.headTree())
      tree.set(m[1]!, this.putBlob(content))
      const parent = this.refs.get(this.branch)
      const sha = this.commitTree(tree, String(b.message), parent ? [parent] : [])
      return { status: 201, body: { commit: { sha } } }
    }
    return { status: 404, body: { message: `Fake: unhandled ${method} ${rest}` } }
  }
}
