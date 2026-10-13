import { SessionContext } from '../repo/SessionContext.ts'
import type { RepoSession } from '../repo/session.ts'
import { useRepoSession } from '../repo/useRepoSession.ts'
import type { Account } from '../settings/settings.ts'

export function SessionProvider({
  account,
  children,
}: {
  account: Account
  children: (session: RepoSession) => React.ReactNode
}) {
  const session = useRepoSession(account)
  if (!session) return null
  return <SessionContext.Provider value={session}>{children(session)}</SessionContext.Provider>
}
