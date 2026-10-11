import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { FakeGitHub, type FakeGitHubOptions } from './fakeGitHub.ts'

/** Start an MSW server backed by a fresh FakeGitHub for the current test file. */
export function setupFakeGitHub(opts: FakeGitHubOptions = {}) {
  const ref: { gh: FakeGitHub } = { gh: new FakeGitHub(opts) }
  const server = setupServer(
    http.all('https://api.github.com/*', async ({ request }) => {
      const headers: Record<string, string> = {}
      request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
      const text = request.method === 'GET' ? '' : await request.text()
      try {
        const res = ref.gh.handle(request.method, request.url, headers, text ? JSON.parse(text) : undefined)
        return HttpResponse.json(res.body as object, { status: res.status })
      } catch {
        return HttpResponse.error()
      }
    }),
  )
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  beforeEach(() => {
    ref.gh = new FakeGitHub(opts)
  })
  afterAll(() => server.close())
  return ref
}
