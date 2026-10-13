import type { TokenProvider } from './auth.ts'
import { DriveError, fromResponse, toDriveError } from './errors.ts'
import { decodeUtf8 } from './md5.ts'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const ROOT_NAME = 'Wisp Notes'
const ROOT_PROP = 'wispRoot'
const FILE_FIELDS = 'id,name,mimeType,parents,md5Checksum,version,trashed'

/** A file or folder as Wisp Notes sees it. */
export interface DriveItem {
  id: string
  name: string
  parentId: string | null
  folder: boolean
  /** Content hash (files only). */
  md5?: string
  version: string
}

interface RawFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  md5Checksum?: string
  version?: string
  trashed?: boolean
}

export interface DriveChange {
  fileId: string
  /** null = removed, trashed, or no longer accessible. */
  item: DriveItem | null
}

function toItem(f: RawFile): DriveItem {
  return {
    id: f.id,
    name: f.name,
    parentId: f.parents?.[0] ?? null,
    folder: f.mimeType === FOLDER_MIME,
    ...(f.md5Checksum ? { md5: f.md5Checksum } : {}),
    version: f.version ?? '0',
  }
}

function mimeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return (
    {
      md: 'text/markdown',
      json: 'application/json',
      txt: 'text/plain',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
    }[ext] ?? 'application/octet-stream'
  )
}

export type Content = string | Blob

/** Thin fetch-based client for the Drive v3 endpoints Wisp Notes uses. */
export class DriveClient {
  private tokens: TokenProvider

  constructor(tokens: TokenProvider) {
    this.tokens = tokens
  }

  private async request(
    method: string,
    url: string,
    init: { query?: Record<string, string>; json?: unknown; body?: BodyInit; contentType?: string } = {},
  ): Promise<Response> {
    const u = new URL(url)
    for (const [k, v] of Object.entries(init.query ?? {})) u.searchParams.set(k, v)
    const token = await this.tokens.getToken()
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    let body = init.body
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json; charset=UTF-8'
      body = JSON.stringify(init.json)
    } else if (init.contentType) {
      headers['Content-Type'] = init.contentType
    }
    let res: Response
    try {
      res = await fetch(u, { method, headers, body })
    } catch (e) {
      throw toDriveError(e)
    }
    if (!res.ok) {
      const errBody: unknown = await res.json().catch(() => undefined)
      const err = fromResponse(res.status, errBody)
      if (err.kind === 'auth') this.tokens.invalidate()
      throw err
    }
    return res
  }

  private async json<T>(
    method: string,
    url: string,
    init?: Parameters<DriveClient['request']>[2],
  ): Promise<T> {
    return (await this.request(method, url, init)).json() as Promise<T>
  }

  async about(): Promise<{ email: string; name: string }> {
    const r = await this.json<{ user: { emailAddress: string; displayName: string } }>(
      'GET',
      `${API}/about`,
      {
        query: { fields: 'user(emailAddress,displayName)' },
      },
    )
    return { email: r.user.emailAddress, name: r.user.displayName }
  }

  /** Find the app's root folder (created by this app on any device) or create it. */
  async ensureRoot(): Promise<string> {
    const r = await this.json<{ files: RawFile[] }>('GET', `${API}/files`, {
      query: {
        q: `appProperties has { key='${ROOT_PROP}' and value='1' } and trashed = false`,
        fields: 'files(id)',
        orderBy: 'createdTime',
        pageSize: '10',
        spaces: 'drive',
      },
    })
    if (r.files[0]) return r.files[0].id
    const created = await this.json<RawFile>('POST', `${API}/files`, {
      query: { fields: 'id' },
      json: { name: ROOT_NAME, mimeType: FOLDER_MIME, appProperties: { [ROOT_PROP]: '1' } },
    })
    return created.id
  }

  /** All non-trashed files and folders the app can see. */
  async listAll(): Promise<DriveItem[]> {
    const out: DriveItem[] = []
    let pageToken: string | undefined
    do {
      const r = await this.json<{ files: RawFile[]; nextPageToken?: string }>('GET', `${API}/files`, {
        query: {
          q: 'trashed = false',
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: '1000',
          spaces: 'drive',
          ...(pageToken ? { pageToken } : {}),
        },
      })
      out.push(...r.files.map(toItem))
      pageToken = r.nextPageToken
    } while (pageToken)
    return out
  }

  async getStartPageToken(): Promise<string> {
    const r = await this.json<{ startPageToken: string }>('GET', `${API}/changes/startPageToken`)
    return r.startPageToken
  }

  /** Changes since `token`. Returns the changes and the token to use next time. */
  async listChanges(token: string): Promise<{ changes: DriveChange[]; nextToken: string }> {
    const changes: DriveChange[] = []
    let pageToken = token
    for (;;) {
      const r = await this.json<{
        changes: { fileId: string; removed?: boolean; file?: RawFile }[]
        nextPageToken?: string
        newStartPageToken?: string
      }>('GET', `${API}/changes`, {
        query: {
          pageToken,
          pageSize: '1000',
          spaces: 'drive',
          includeRemoved: 'true',
          fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
        },
      })
      for (const c of r.changes) {
        const gone = c.removed || !c.file || c.file.trashed
        changes.push({ fileId: c.fileId, item: gone ? null : toItem(c.file!) })
      }
      if (r.newStartPageToken) return { changes, nextToken: r.newStartPageToken }
      if (!r.nextPageToken) throw new DriveError('unknown', 'Drive changes feed ended without a token.')
      pageToken = r.nextPageToken
    }
  }

  async download(id: string): Promise<string> {
    const res = await this.request('GET', `${API}/files/${encodeURIComponent(id)}`, {
      query: { alt: 'media' },
    })
    return decodeUtf8(await res.arrayBuffer())
  }

  async createFolder(name: string, parentId: string): Promise<DriveItem> {
    const f = await this.json<RawFile>('POST', `${API}/files`, {
      query: { fields: FILE_FIELDS },
      json: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    })
    return toItem(f)
  }

  /** Create a file with content (multipart upload). */
  async createFile(name: string, parentId: string, content: Content): Promise<DriveItem> {
    const boundary = `wisp${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    const mime = typeof content === 'string' ? mimeFor(name) : content.type || mimeFor(name)
    const meta = JSON.stringify({ name, parents: [parentId], mimeType: mime })
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      content,
      `\r\n--${boundary}--\r\n`,
    ])
    const f = await this.json<RawFile>('POST', `${UPLOAD}/files`, {
      query: { uploadType: 'multipart', fields: FILE_FIELDS },
      body,
      contentType: `multipart/related; boundary=${boundary}`,
    })
    return toItem(f)
  }

  async updateContent(id: string, name: string, content: Content): Promise<DriveItem> {
    const f = await this.json<RawFile>('PATCH', `${UPLOAD}/files/${encodeURIComponent(id)}`, {
      query: { uploadType: 'media', fields: FILE_FIELDS },
      body: content,
      contentType:
        typeof content === 'string' ? `${mimeFor(name)}; charset=UTF-8` : content.type || mimeFor(name),
    })
    return toItem(f)
  }

  /** Rename and/or move. */
  async update(id: string, opts: { name?: string; from?: string; to?: string }): Promise<DriveItem> {
    const query: Record<string, string> = { fields: FILE_FIELDS }
    if (opts.to && opts.from && opts.to !== opts.from) {
      query.addParents = opts.to
      query.removeParents = opts.from
    }
    const f = await this.json<RawFile>('PATCH', `${API}/files/${encodeURIComponent(id)}`, {
      query,
      json: opts.name !== undefined ? { name: opts.name } : {},
    })
    return toItem(f)
  }

  /** Move to Drive trash (recoverable for 30 days). */
  async trash(id: string): Promise<void> {
    await this.request('PATCH', `${API}/files/${encodeURIComponent(id)}`, {
      query: { fields: 'id' },
      json: { trashed: true },
    })
  }
}
