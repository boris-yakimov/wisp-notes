import type { GisOauth2, TokenClientConfig } from '../drive/gis.ts'

export interface FakeGisOptions {
  token?: string
  /** Simulate the user closing the popup. */
  cancel?: boolean
  /** Simulate the user unticking Drive access. */
  denyScope?: boolean
}

/** Install a fake `window.google.accounts.oauth2` (Google Identity Services). */
export function installFakeGis(opts: FakeGisOptions = {}) {
  const calls: { prompt?: string; login_hint?: string }[] = []
  const revoked: string[] = []
  const oauth2: GisOauth2 = {
    initTokenClient(config: TokenClientConfig) {
      return {
        requestAccessToken(override) {
          calls.push(override ?? {})
          setTimeout(() => {
            if (opts.cancel) config.error_callback?.({ type: 'popup_closed' })
            else
              config.callback({
                access_token: opts.token ?? 'good-token',
                expires_in: 3599,
                scope: opts.denyScope ? 'email' : config.scope,
              })
          }, 0)
        },
      }
    },
    hasGrantedAllScopes: (resp, ...scopes) => scopes.every((s) => resp.scope.split(' ').includes(s)),
    revoke: (token, done) => {
      revoked.push(token)
      done?.()
    },
  }
  window.google = { accounts: { oauth2 } }
  return { calls, revoked }
}

/** Store a valid access token as if the user had signed in earlier. */
export function storeToken(token = 'good-token', expiresInMs = 3_600_000) {
  localStorage.setItem('wisp-notes:token', JSON.stringify({ token, expiresAt: Date.now() + expiresInMs }))
}
