import { installFakeGis } from '../test/fakeGis.ts'
import { DRIVE_SCOPE, GoogleAuth, loadGis } from './auth.ts'

const make = (now = () => Date.now()) => new GoogleAuth('client-id', { load: loadGis, now })

describe('GoogleAuth', () => {
  it('signs in, stores the token and notifies listeners', async () => {
    const gis = installFakeGis({ token: 'tok' })
    const auth = make()
    const changed = vi.fn()
    auth.subscribe(changed)
    expect(auth.hasValidToken).toBe(false)
    await expect(auth.getToken()).rejects.toMatchObject({ kind: 'auth' })
    expect(await auth.signIn('me@example.com')).toBe('tok')
    expect(gis.calls).toEqual([{ prompt: '', login_hint: 'me@example.com' }])
    expect(await auth.getToken()).toBe('tok')
    expect(changed).toHaveBeenCalled()
    // Survives a reload (new instance) until it expires.
    expect(await make().getToken()).toBe('tok')
  })

  it('treats tokens as expired a minute early', async () => {
    installFakeGis()
    let t = 1_000_000
    const auth = make(() => t)
    await auth.signIn()
    t += 3599_000 - 61_000
    expect(auth.hasValidToken).toBe(true)
    t += 2_000
    expect(auth.hasValidToken).toBe(false)
    await expect(auth.getToken()).rejects.toMatchObject({ kind: 'auth' })
  })

  it('reports cancellation and missing Drive permission', async () => {
    installFakeGis({ cancel: true })
    await expect(make().signIn()).rejects.toMatchObject({ kind: 'cancelled' })
    installFakeGis({ denyScope: true })
    await expect(make().signIn()).rejects.toMatchObject({
      kind: 'auth',
      message: expect.stringContaining('Drive access was not granted'),
    })
  })

  it('requests only the drive.file scope', async () => {
    installFakeGis()
    const init = vi.spyOn(window.google!.accounts!.oauth2!, 'initTokenClient')
    await make().preload()
    expect(init.mock.calls[0]![0].scope).toBe(DRIVE_SCOPE)
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file')
  })

  it('signs out and revokes', async () => {
    const gis = installFakeGis({ token: 'tok' })
    const auth = make()
    await auth.signIn()
    auth.signOut()
    expect(gis.revoked).toEqual(['tok'])
    expect(auth.hasValidToken).toBe(false)
  })

  it('invalidate drops the token', async () => {
    installFakeGis()
    const auth = make()
    await auth.signIn()
    auth.invalidate()
    expect(auth.hasValidToken).toBe(false)
  })
})
