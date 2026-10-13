import { test as base, type Page } from '@playwright/test'
import { FakeDrive, type FakeDriveOptions } from '../src/test/fakeDrive.ts'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': '*',
}

/**
 * Stand-in for https://accounts.google.com/gsi/client: grants a token for the requested scope
 * as soon as `requestAccessToken` is called (like a user clicking "Allow" in the popup).
 */
const GIS_STUB = `
window.google = { accounts: { oauth2: {
  initTokenClient(config) {
    return { requestAccessToken() {
      setTimeout(() => config.callback({ access_token: 'good-token', expires_in: 3599, scope: config.scope }), 50)
    } }
  },
  hasGrantedAllScopes(resp, ...scopes) { return scopes.every((s) => resp.scope.split(' ').includes(s)) },
  revoke(token, done) { done && done() },
} } }
`

/** Route the page's Google Drive API and sign-in traffic to an in-memory FakeDrive. */
export async function mockGoogle(page: Page, opts: FakeDriveOptions): Promise<FakeDrive> {
  const drive = new FakeDrive(opts)
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB }),
  )
  await page.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    let res
    try {
      const body = req.postDataBuffer()
      res = drive.handle(
        req.method(),
        req.url(),
        await req.allHeaders(),
        body ? new Uint8Array(body) : undefined,
      )
    } catch {
      return route.abort('internetdisconnected')
    }
    if (res.raw) {
      return route.fulfill({
        status: res.status,
        headers: { ...cors, 'content-type': res.contentType ?? 'application/octet-stream' },
        body: Buffer.from(res.raw),
      })
    }
    return route.fulfill({
      status: res.status,
      headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(res.body),
    })
  })
  return drive
}

export const test = base.extend<{ drive: FakeDrive }>({
  drive: async ({ page }, use) => {
    const drive = await mockGoogle(page, {
      files: {
        'Inbox.md': '# Inbox\n\nThings to sort.',
        'Work/_meta.json': '{"icon":"briefcase"}',
        'Work/Plan.md': '# Plan\n\nShip **Wisp Notes** this week.\n\n- [ ] write tests\n',
        'Home/Recipes.md': 'Pancakes: flour, milk, eggs.',
      },
    })
    const problems: string[] = []
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text()))
        problems.push(m.text())
    })
    await use(drive)
    if (problems.length) throw new Error('Browser errors:\n' + problems.join('\n'))
  },
})

export { expect } from '@playwright/test'
