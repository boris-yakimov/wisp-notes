import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { FakeDrive, type FakeDriveOptions } from './fakeDrive.ts'

/** Start an MSW server backed by a fresh FakeDrive (per test) for the current test file. */
export function setupFakeDrive(opts: FakeDriveOptions = {}) {
  const ref: { drive: FakeDrive } = { drive: new FakeDrive(opts) }
  const server = setupServer(
    http.all('https://www.googleapis.com/*', async ({ request }) => {
      const headers: Record<string, string> = {}
      request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
      const body = request.method === 'GET' ? undefined : new Uint8Array(await request.arrayBuffer())
      try {
        const res = ref.drive.handle(request.method, request.url, headers, body)
        if (res.raw) {
          return new HttpResponse(res.raw.slice().buffer, {
            status: res.status,
            headers: { 'content-type': res.contentType ?? 'application/octet-stream' },
          })
        }
        return HttpResponse.json(res.body as object, { status: res.status })
      } catch {
        return HttpResponse.error()
      }
    }),
  )
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  beforeEach(() => {
    ref.drive = new FakeDrive(opts)
  })
  afterAll(() => server.close())
  return ref
}
