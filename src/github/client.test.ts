import { GitHubClient, validateConnection } from './client.ts'
import { base64ToUtf8, utf8ToBase64 } from './base64.ts'
import { setupFakeGitHub } from '../test/msw.ts'

const fake = setupFakeGitHub({ files: { 'a.md': 'hello' } })
const cfg = { token: 'good-token', owner: 'me', repo: 'notes', branch: 'main' }

describe('validateConnection', () => {
  it('succeeds for a valid token and repo (200)', async () => {
    expect(await validateConnection(new GitHubClient(cfg))).toEqual({ ok: true, fullName: 'me/notes' })
  })

  it('reports a bad token (401)', async () => {
    const res = await validateConnection(new GitHubClient({ ...cfg, token: 'nope' }))
    expect(res).toMatchObject({ ok: false, kind: 'bad-token' })
  })

  it('reports a missing repo (404)', async () => {
    const res = await validateConnection(new GitHubClient({ ...cfg, repo: 'missing' }))
    expect(res).toMatchObject({ ok: false, kind: 'not-found' })
  })

  it('reports a missing branch', async () => {
    const res = await validateConnection(new GitHubClient({ ...cfg, branch: 'dev' }))
    expect(res).toMatchObject({ ok: false, kind: 'not-found', message: 'Branch "dev" not found.' })
  })

  it('reports insufficient scope (read-only)', async () => {
    fake.gh.canPush = false
    const res = await validateConnection(new GitHubClient(cfg))
    expect(res).toMatchObject({ ok: false, kind: 'read-only' })
  })

  it('reports an empty repository', async () => {
    fake.gh.refs.clear()
    const res = await validateConnection(new GitHubClient(cfg))
    expect(res).toMatchObject({ ok: false, kind: 'empty-repo' })
  })

  it('reports network errors', async () => {
    fake.gh.offline = true
    const res = await validateConnection(new GitHubClient(cfg))
    expect(res).toMatchObject({ ok: false, kind: 'network' })
  })
})

describe('base64', () => {
  it('round-trips UTF-8 with emoji and accents', () => {
    const s = 'Ünïcödé café — 🎉 日本語\n'
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s)
  })

  it('decodes GitHub-style base64 with line breaks', () => {
    const b64 = utf8ToBase64('héllo 👋 wörld').replace(/(.{8})/g, '$1\n')
    expect(base64ToUtf8(b64)).toBe('héllo 👋 wörld')
  })
})
