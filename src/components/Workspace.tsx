import { SessionContext } from '../repo/SessionContext.ts'
import type { RepoSession } from '../repo/session.ts'
import { useRepoSession } from '../repo/useRepoSession.ts'
import { useApp } from '../store/app.ts'

export function SessionProvider({ children }: { children: (session: RepoSession) => React.ReactNode }) {
  const settings = useApp((s) => s.settings)
  const session = useRepoSession(settings)
  if (!session) return null
  return <SessionContext.Provider value={session}>{children(session)}</SessionContext.Provider>
}
