import { createHash } from 'node:crypto'

/**
 * In-memory fake of the subset of the Google Drive v3 API used by Wisp Notes.
 * Framework-agnostic: adapted to MSW (unit tests, see msw.ts) and to Playwright's
 * page.route (E2E, see e2e/fixtures.ts).
 */

export interface FakeResponse {
  status: number
  /** JSON body, or raw bytes for media downloads. */
  body: unknown
  raw?: Uint8Array
  contentType?: string
}

interface FFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  content?: Uint8Array
  version: number
  trashed: boolean
  appProperties: Record<string, string>
  created: number
  /** Not created/opened by the app: invisible under the drive.file scope. */
  foreign?: boolean
}

export interface FakeDriveOptions {
  token?: string
  /** Notes inside the app's "Wisp Notes" folder: path → content. */
  files?: Record<string, string>
  /** Start without the app's root folder (first sign-in). */
  noRoot?: boolean
}

const FOLDER = 'application/vnd.google-apps.folder'
const MY_DRIVE = 'my-drive-root'
const enc = new TextEncoder()
const dec = new TextDecoder()

export function md5(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex')
}

const err = (status: number, message: string, reason = ''): FakeResponse => ({
  status,
  body: { error: { code: status, message, errors: reason ? [{ reason, message }] : [] } },
})

export class FakeDrive {
  token: string
  store = new Map<string, FFile>()
  /** File IDs in change order; a page token is an index into this list. */
  changeLog: string[] = []
  rootId: string | null = null
  /** Every handled request, for assertions. */
  log: { method: string; path: string; query: string }[] = []
  offline = false
  /** Server-side page size cap (Drive caps listings too). */
  maxPageSize = 1000
  /** Inject a one-shot failure for the next request matching the predicate. */
  failNext: ((method: string, path: string) => FakeResponse | undefined) | undefined
  private nextId = 1
  private clock = 1

  constructor(opts: FakeDriveOptions = {}) {
    this.token = opts.token ?? 'good-token'
    if (!opts.noRoot) {
      this.rootId = this.create({
        name: 'Wisp Notes',
        mimeType: FOLDER,
        parents: [MY_DRIVE],
        appProperties: { wispRoot: '1' },
      }).id
      for (const [path, content] of Object.entries(opts.files ?? {})) this.write(path, content)
      this.changeLog = [] // seeded state is "before" any client session
    }
  }

  // ------------------------------------------------------------ test helpers

  private create(f: Partial<FFile> & { name: string; mimeType: string; parents: string[] }): FFile {
    const file: FFile = {
      id: `f${this.nextId++}`,
      version: this.clock++,
      trashed: false,
      appProperties: {},
      created: this.clock,
      ...f,
    }
    this.store.set(file.id, file)
    this.changeLog.push(file.id)
    return file
  }

  private touch(f: FFile) {
    f.version = this.clock++
    this.changeLog.push(f.id)
  }

  /** Path (relative to the Wisp Notes root) of a live file, or null if not under the root. */
  pathOf(id: string): string | null {
    const parts: string[] = []
    let f = this.store.get(id)
    while (f && f.id !== this.rootId) {
      if (f.trashed) return null
      parts.unshift(f.name)
      f = this.store.get(f.parents[0] ?? '')
    }
    return f ? parts.join('/') : null
  }

  private findPath(path: string): FFile | undefined {
    for (const f of this.store.values()) if (!f.trashed && this.pathOf(f.id) === path) return f
    return undefined
  }

  private ensureFolder(path: string): FFile {
    if (!path) return this.store.get(this.rootId!)!
    const existing = this.findPath(path)
    if (existing) return existing
    const i = path.lastIndexOf('/')
    const parent = this.ensureFolder(i === -1 ? '' : path.slice(0, i))
    return this.create({ name: path.slice(i + 1), mimeType: FOLDER, parents: [parent.id] })
  }

  /** Simulate another device: write content (creating folders), or null to trash. */
  write(path: string, content: string | null): void {
    const existing = this.findPath(path)
    if (content === null) {
      if (existing) {
        existing.trashed = true
        this.touch(existing)
      }
      return
    }
    if (existing) {
      existing.content = enc.encode(content)
      this.touch(existing)
      return
    }
    const i = path.lastIndexOf('/')
    const parent = this.ensureFolder(i === -1 ? '' : path.slice(0, i))
    this.create({
      name: path.slice(i + 1),
      mimeType: 'text/markdown',
      parents: [parent.id],
      content: enc.encode(content),
    })
  }

  /** Simulate another device creating a folder. */
  mkdir(path: string): void {
    this.ensureFolder(path)
  }

  /** Live text files under the root: path → content. */
  files(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const f of this.store.values()) {
      if (f.mimeType === FOLDER || f.trashed) continue
      const p = this.pathOf(f.id)
      if (p !== null) out[p] = dec.decode(f.content ?? new Uint8Array())
    }
    return out
  }

  /** Live folder paths under the root. */
  folders(): string[] {
    return [...this.store.values()]
      .filter((f) => f.mimeType === FOLDER && !f.trashed && f.id !== this.rootId)
      .map((f) => this.pathOf(f.id))
      .filter((p): p is string => p !== null)
      .sort()
  }

  bytes(path: string): Uint8Array | undefined {
    return this.findPath(path)?.content
  }

  /**
   * Simulate the user moving/renaming the app folder in Drive, e.g. `['Personal']` + `'Notes'`.
   * Folders in `parents` are the user's own (not visible to the app).
   */
  relocateRoot(parents: string[], name: string): void {
    let parent = MY_DRIVE
    for (const p of parents) {
      const f = this.create({ name: p, mimeType: FOLDER, parents: [parent], foreign: true })
      this.changeLog.pop()
      parent = f.id
    }
    const root = this.store.get(this.rootId!)!
    root.name = name
    root.parents = [parent]
    this.touch(root)
  }

  /** Number of mutating requests (create/update/trash). */
  writeCount(): number {
    return this.log.filter((l) => l.method !== 'GET').length
  }

  // ------------------------------------------------------------ HTTP

  private raw(f: FFile) {
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      parents: f.parents,
      version: String(f.version),
      trashed: f.trashed,
      ...(f.mimeType !== FOLDER ? { md5Checksum: md5(f.content ?? new Uint8Array()) } : {}),
    }
  }

  handle(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: Uint8Array | undefined,
  ): FakeResponse {
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname)
    const q = u.searchParams
    this.log.push({ method, path, query: u.search })
    if (this.offline) throw new TypeError('Failed to fetch')
    const injected = this.failNext?.(method, path)
    if (injected) {
      this.failNext = undefined
      return injected
    }
    if ((headers['authorization'] ?? '') !== `Bearer ${this.token}`) {
      return err(401, 'Request had invalid authentication credentials.', 'authError')
    }
    const json = () => (body?.length ? (JSON.parse(dec.decode(body)) as Record<string, unknown>) : {})
    let m: RegExpMatchArray | null

    if (method === 'GET' && path === '/drive/v3/about') {
      return { status: 200, body: { user: { emailAddress: 'me@example.com', displayName: 'Me' } } }
    }
    if (method === 'GET' && path === '/drive/v3/changes/startPageToken') {
      return { status: 200, body: { startPageToken: String(this.changeLog.length) } }
    }
    if (method === 'GET' && path === '/drive/v3/changes') {
      const start = Number(q.get('pageToken'))
      if (!Number.isInteger(start) || start < 0 || start > this.changeLog.length) {
        return err(400, 'Invalid page token', 'invalid')
      }
      const size = Math.min(Number(q.get('pageSize') ?? 100), this.maxPageSize)
      const ids = this.changeLog.slice(start, start + size)
      const end = start + ids.length
      return {
        status: 200,
        body: {
          changes: ids.map((id) => ({ fileId: id, removed: false, file: this.raw(this.store.get(id)!) })),
          ...(end < this.changeLog.length
            ? { nextPageToken: String(end) }
            : { newStartPageToken: String(end) }),
        },
      }
    }
    if (method === 'GET' && path === '/drive/v3/files') {
      const query = q.get('q') ?? ''
      let list = [...this.store.values()].filter((f) => !f.trashed && !f.foreign)
      if (query.includes('appProperties has')) list = list.filter((f) => f.appProperties.wispRoot === '1')
      list.sort((a, b) => a.created - b.created)
      const size = Math.min(Number(q.get('pageSize') ?? 100), this.maxPageSize)
      const start = Number(q.get('pageToken') ?? 0)
      const page = list.slice(start, start + size)
      return {
        status: 200,
        body: {
          files: page.map((f) => this.raw(f)),
          ...(start + size < list.length ? { nextPageToken: String(start + size) } : {}),
        },
      }
    }
    if (method === 'GET' && path === '/drive/v3/files/root') {
      return { status: 200, body: { id: MY_DRIVE } }
    }
    if ((m = path.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
      const f = this.store.get(m[1]!)
      if (!f || f.foreign) return err(404, 'File not found', 'notFound')
      if (method === 'GET') {
        if (q.get('alt') === 'media')
          return { status: 200, body: null, raw: f.content ?? new Uint8Array(), contentType: f.mimeType }
        return { status: 200, body: this.raw(f) }
      }
      if (method === 'PATCH') {
        const b = json()
        if (typeof b.name === 'string') f.name = b.name
        if (b.trashed === true) f.trashed = true
        const add = q.get('addParents')
        const remove = q.get('removeParents')
        if (add) {
          if (!this.store.get(add)) return err(404, 'Parent not found', 'notFound')
          f.parents = [...f.parents.filter((p) => p !== remove), add]
        }
        this.touch(f)
        return { status: 200, body: this.raw(f) }
      }
    }
    if (method === 'POST' && path === '/drive/v3/files') {
      const b = json() as {
        name: string
        mimeType?: string
        parents?: string[]
        appProperties?: Record<string, string>
      }
      const f = this.create({
        name: b.name,
        mimeType: b.mimeType ?? 'application/octet-stream',
        parents: b.parents ?? [MY_DRIVE],
        appProperties: b.appProperties ?? {},
      })
      if (b.appProperties?.wispRoot === '1') this.rootId ??= f.id
      return { status: 200, body: this.raw(f) }
    }
    if (method === 'POST' && path === '/upload/drive/v3/files' && q.get('uploadType') === 'multipart') {
      const boundary = /boundary=([^;]+)/.exec(headers['content-type'] ?? '')?.[1]
      if (!boundary || !body) return err(400, 'Bad multipart body')
      const text = Buffer.from(body).toString('latin1')
      const parts = text
        .split(`--${boundary}`)
        .slice(1, -1)
        .map((p) => p.slice(p.indexOf('\r\n\r\n') + 4, p.endsWith('\r\n') ? -2 : undefined))
      if (parts.length !== 2) return err(400, 'Expected 2 parts')
      const meta = JSON.parse(Buffer.from(parts[0]!, 'latin1').toString('utf8')) as {
        name: string
        parents: string[]
        mimeType: string
      }
      if (!meta.parents?.every((p) => this.store.get(p))) return err(404, 'Parent not found', 'notFound')
      const f = this.create({
        name: meta.name,
        mimeType: meta.mimeType,
        parents: meta.parents,
        content: new Uint8Array(Buffer.from(parts[1]!, 'latin1')),
      })
      return { status: 200, body: this.raw(f) }
    }
    if (method === 'PATCH' && (m = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/))) {
      const f = this.store.get(m[1]!)
      if (!f || f.trashed) return err(404, 'File not found', 'notFound')
      f.content = body ?? new Uint8Array()
      this.touch(f)
      return { status: 200, body: this.raw(f) }
    }
    return err(404, `Fake: unhandled ${method} ${path}`)
  }
}
