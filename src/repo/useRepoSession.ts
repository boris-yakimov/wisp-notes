import { useEffect, useState } from 'react'
import { getCache } from '../cache/instance.ts'
import { GitHubClient } from '../github/client.ts'
import { RepoSession, useRepo } from './session.ts'
import { repoKey, type Settings } from '../settings/settings.ts'

/** Creates the RepoSession for the configured repo and wires global events. */
export function useRepoSession(settings: Settings): RepoSession | null {
  const [session, setSession] = useState<RepoSession | null>(null)
  const { token, owner, repo, branch } = settings

  useEffect(() => {
    let disposed = false
    let s: RepoSession | undefined
    void getCache().then((cache) => {
      if (disposed) return
      s = new RepoSession(
        new GitHubClient({ token, owner, repo, branch }),
        cache,
        repoKey({ owner, repo, branch }),
      )
      setSession(s)
      void s.start()
    })
    return () => {
      disposed = true
      s?.dispose()
      setSession(null)
    }
  }, [token, owner, repo, branch])

  useEffect(() => {
    if (!session) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (session.saver.hasPending || Object.keys(useRepo.getState().dirty).length > 0) {
        void session.saver.saveNow()
        e.preventDefault()
      }
    }
    const onOnline = () => {
      void session.revalidate()
      if (Object.keys(useRepo.getState().dirty).length) void session.saver.saveNow()
    }
    const onOffline = () => useRepo.setState({ online: false })
    const onVisible = () => {
      if (document.visibilityState === 'visible') void session.revalidate()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session])

  return session
}
