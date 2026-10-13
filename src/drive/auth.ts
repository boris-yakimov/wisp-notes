import { DriveError } from './errors.ts'
import type { GisOauth2, TokenClient, TokenResponse } from './gis.ts'

/** Drive access limited to files created or imported by this app. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const TOKEN_KEY = 'wisp-notes:token'
/** Treat tokens as expired slightly early to avoid failing mid-request. */
const EXPIRY_MARGIN_MS = 60_000

export const GOOGLE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined

export interface TokenProvider {
  /** A valid access token. Never opens UI: throws DriveError('auth') if the user must sign in. */
  getToken(): Promise<string>
  /** Forget the current token (e.g. after a 401). */
  invalidate(): void
}

interface StoredToken {
  token: string
  expiresAt: number
}

/** Load the GIS script once. */
let gisPromise: Promise<GisOauth2> | null = null
export function loadGis(): Promise<GisOauth2> {
  const ready = window.google?.accounts?.oauth2
  if (ready) return Promise.resolve(ready)
  gisPromise ??= new Promise<GisOauth2>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => {
      const o = window.google?.accounts?.oauth2
      if (o) resolve(o)
      else reject(new DriveError('unknown', 'Google sign-in failed to initialize.'))
    }
    s.onerror = () => {
      gisPromise = null
      reject(new DriveError('network', 'Could not load Google sign-in. Check your connection.'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

/**
 * Google sign-in via the GIS token model (browser only, no refresh tokens).
 * The access token (≤1 h) is kept in localStorage until it expires so reloads stay signed in.
 * Getting a new token requires a user click (`signIn`), because GIS opens a popup.
 */
export class GoogleAuth implements TokenProvider {
  private client: TokenClient | null = null
  private oauth2: GisOauth2 | null = null
  private pending: { resolve: (t: string) => void; reject: (e: unknown) => void } | null = null
  private listeners = new Set<() => void>()
  private clientId: string
  private now: () => number
  private load: () => Promise<GisOauth2>

  constructor(clientId: string, opts: { load?: () => Promise<GisOauth2>; now?: () => number } = {}) {
    this.clientId = clientId
    this.load = opts.load ?? loadGis
    this.now = opts.now ?? Date.now
  }

  /** Load GIS ahead of time so `signIn` can open the popup synchronously inside the click handler. */
  async preload(): Promise<void> {
    if (this.client) return
    const oauth2 = await this.load()
    this.oauth2 = oauth2
    this.client = oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => this.onToken(resp),
      error_callback: (err) => {
        const p = this.pending
        this.pending = null
        p?.reject(
          err.type === 'popup_failed_to_open'
            ? new DriveError('auth', 'The Google sign-in popup was blocked. Allow popups for this site.')
            : new DriveError('cancelled', 'Sign-in was cancelled.'),
        )
      },
    })
  }

  private onToken(resp: TokenResponse) {
    const p = this.pending
    this.pending = null
    if (resp.error || !resp.access_token) {
      p?.reject(new DriveError('auth', resp.error_description || 'Google sign-in failed.'))
      return
    }
    if (this.oauth2 && !this.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
      p?.reject(
        new DriveError('auth', 'Google Drive access was not granted. Sign in again and allow Drive access.'),
      )
      return
    }
    const stored: StoredToken = {
      token: resp.access_token,
      expiresAt: this.now() + Number(resp.expires_in) * 1000,
    }
    localStorage.setItem(TOKEN_KEY, JSON.stringify(stored))
    this.emit()
    p?.resolve(stored.token)
  }

  /** Open the Google popup. Call from a click handler. */
  async signIn(loginHint?: string): Promise<string> {
    if (!this.client) await this.preload()
    return new Promise<string>((resolve, reject) => {
      this.pending?.reject(new DriveError('cancelled', 'Sign-in was restarted.'))
      this.pending = { resolve, reject }
      this.client!.requestAccessToken({ prompt: '', ...(loginHint ? { login_hint: loginHint } : {}) })
    })
  }

  signOut(): void {
    const t = this.stored()
    localStorage.removeItem(TOKEN_KEY)
    if (t) this.oauth2?.revoke(t.token)
    this.emit()
  }

  private stored(): StoredToken | null {
    try {
      const raw = localStorage.getItem(TOKEN_KEY)
      return raw ? (JSON.parse(raw) as StoredToken) : null
    } catch {
      return null
    }
  }

  /** True if a non-expired token is available. */
  get hasValidToken(): boolean {
    const t = this.stored()
    return !!t && t.expiresAt - EXPIRY_MARGIN_MS > this.now()
  }

  async getToken(): Promise<string> {
    const t = this.stored()
    if (t && t.expiresAt - EXPIRY_MARGIN_MS > this.now()) return t.token
    throw new DriveError('auth', 'Your Google sign-in expired. Sign in again to sync.')
  }

  invalidate(): void {
    localStorage.removeItem(TOKEN_KEY)
    this.emit()
  }

  /** Called when a token is obtained or dropped. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}

let shared: GoogleAuth | null = null
/** App-wide auth instance (requires VITE_GOOGLE_CLIENT_ID). */
export function getAuth(): GoogleAuth {
  if (!GOOGLE_CLIENT_ID) throw new DriveError('unknown', 'VITE_GOOGLE_CLIENT_ID is not configured.')
  shared ??= new GoogleAuth(GOOGLE_CLIENT_ID)
  return shared
}

/** Tests only. */
export function resetAuthForTests(): void {
  shared = null
  gisPromise = null
}
