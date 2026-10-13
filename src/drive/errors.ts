/** Normalized Drive/auth errors so the UI can show clear messages. */

export type DriveErrorKind =
  | 'auth' // no valid token: user must sign in (again)
  | 'cancelled' // user closed the sign-in popup
  | 'forbidden' // 403: no access to the file
  | 'quota' // Google storage full
  | 'rate-limit' // 403/429 rate limiting
  | 'not-found' // 404
  | 'network' // offline / fetch failed
  | 'unknown'

export class DriveError extends Error {
  readonly kind: DriveErrorKind
  readonly status: number | undefined
  constructor(kind: DriveErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'DriveError'
    this.kind = kind
    this.status = status
  }
}

interface GoogleErrorBody {
  error?: { message?: string; errors?: { reason?: string }[] }
}

/** Map an HTTP error response from the Drive API to a DriveError. */
export function fromResponse(status: number, body: unknown): DriveError {
  const err = (body as GoogleErrorBody | undefined)?.error
  const reason = err?.errors?.[0]?.reason ?? ''
  const msg = err?.message ?? ''
  switch (true) {
    case status === 401:
      return new DriveError('auth', 'Your Google sign-in expired. Sign in again to sync.', status)
    case status === 429 || /rateLimit/i.test(reason):
      return new DriveError('rate-limit', 'Google Drive rate limit reached. Retrying shortly.', status)
    case /storageQuotaExceeded|quotaExceeded/i.test(reason):
      return new DriveError('quota', 'Your Google storage is full.', status)
    case status === 403:
      return new DriveError('forbidden', `Google Drive denied access${msg ? `: ${msg}` : '.'}`, status)
    case status === 404:
      return new DriveError('not-found', 'The file was not found in Google Drive.', status)
    default:
      return new DriveError('unknown', `Google Drive error ${status}${msg ? `: ${msg}` : ''}`, status)
  }
}

export function toDriveError(e: unknown): DriveError {
  if (e instanceof DriveError) return e
  if (e instanceof TypeError)
    return new DriveError('network', 'Cannot reach Google Drive. You appear to be offline.')
  return new DriveError('unknown', e instanceof Error ? e.message : String(e))
}

export function isNetworkError(e: unknown): boolean {
  return toDriveError(e).kind === 'network'
}

export function isAuthError(e: unknown): boolean {
  return toDriveError(e).kind === 'auth'
}
