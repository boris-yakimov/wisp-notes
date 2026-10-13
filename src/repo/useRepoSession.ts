import { useEffect, useState } from 'react'
import { getCache } from '../cache/instance.ts'
import { getAuth } from '../drive/auth.ts'
import { DriveClient } from '../drive/client.ts'
import { repoKey, type Account } from '../settings/settings.ts'
import { RepoSession, useRepo } from './session.ts'

/** While the tab is visible, check Drive for changes this often. */
const POLL_MS = 60_000

/** Creates the RepoSession for the signed-in account and wires global events. */
export function useRepoSession(account: Account): RepoSession | null {
  const [session, setSession] = useState<RepoSession | null>(null)
  const email = account.email

  useEffect(() => {
    let disposed = false
    let s: RepoSession | undefined
    void getCache().then((cache) => {
      if (disposed) return
      const auth = getAuth()
      s = new RepoSession(new DriveClient(auth), cache, repoKey({ email, name: '' }))
      setSession(s)
      if (!auth.hasValidToken) useRepo.setState({ authRequired: true })
      void s.start()
    })
    return () => {
      disposed = true
      s?.dispose()
      setSession(null)
    }
  }, [email])

  useEffect(() => {
    if (!session) return
    const auth = getAuth()
    void auth.preload().catch(() => undefined) // so "Sign in" can open the popup immediately
    const hasDrafts = () => Object.keys(useRepo.getState().dirty).length > 0
    const refresh = () => {
      void session.revalidate()
      if (hasDrafts()) void session.saver.saveNow()
    }
    const unsubscribe = auth.subscribe(() => {
      if (auth.hasValidToken) {
        useRepo.setState({ authRequired: false })
        refresh()
      }
    })
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (session.saver.hasPending || hasDrafts()) {
        void session.saver.saveNow()
        e.preventDefault()
      }
    }
    const onOffline = () => useRepo.setState({ online: false })
    const onVisible = () => {
      if (document.visibilityState === 'visible') void session.revalidate()
    }
    const onFocus = () => void session.revalidate()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void session.revalidate()
    }, POLL_MS)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unsubscribe()
      clearInterval(timer)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session])

  return session
}
