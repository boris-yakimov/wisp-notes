import { createContext, useContext } from 'react'
import type { RepoSession } from './session.ts'

export const SessionContext = createContext<RepoSession | null>(null)

/** The connected repository session. Only use inside <SessionContext.Provider>. */
export function useSession(): RepoSession {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession must be used inside SessionContext')
  return s
}
