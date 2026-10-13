/** Minimal types for the Google Identity Services token model (https://accounts.google.com/gsi/client). */

export interface TokenResponse {
  access_token: string
  expires_in: number | string
  scope: string
  error?: string
  error_description?: string
}

export interface TokenClientConfig {
  client_id: string
  scope: string
  callback: (resp: TokenResponse) => void
  error_callback?: (err: { type: string; message?: string }) => void
  prompt?: string
  include_granted_scopes?: boolean
}

export interface TokenClient {
  requestAccessToken(override?: { prompt?: string; login_hint?: string }): void
}

export interface GisOauth2 {
  initTokenClient(config: TokenClientConfig): TokenClient
  hasGrantedAllScopes(resp: TokenResponse, ...scopes: string[]): boolean
  revoke(token: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } }
  }
}
