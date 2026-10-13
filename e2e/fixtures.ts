import { test as base, type Page } from '@playwright/test'
import { FakeGitHub, type FakeGitHubOptions } from '../src/test/fakeGitHub.ts'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': '*',
}

/** Route all GitHub API traffic of the page to an in-memory FakeGitHub. */
export async function mockGitHub(page: Page, opts: FakeGitHubOptions): Promise<FakeGitHub> {
  const gh = new FakeGitHub(opts)
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    let res
    try {
      res = gh.handle(req.method(), req.url(), req.headers(), req.postData() ? req.postDataJSON() : undefined)
    } catch {
      return route.abort('internetdisconnected')
    }
    return route.fulfill({
      status: res.status,
      headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(res.body),
    })
  })
  return gh
}

export const test = base.extend<{ gh: FakeGitHub }>({
  gh: async ({ page }, use) => {
    const gh = await mockGitHub(page, {
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
    await use(gh)
    if (problems.length) throw new Error('Browser errors:\n' + problems.join('\n'))
  },
})

export { expect } from '@playwright/test'
