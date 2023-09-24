import { Center, Spinner } from '@chakra-ui/react'
import { SessionInfo } from '@shared/types'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { useAsync } from 'react-use'
import { NeedsAuthError, UnexpectedServerError } from '../lib/api'
import { useAPI } from './APIContext'

const SessionContext = createContext<SessionInfo | null>(null)
export const useSession = () => useContext(SessionContext)

export function RequireSession({ children }: { children: React.ReactNode }) {
  const { getSession } = useAPI()
  const [sessionTry, setSessionTry] = useState(0)
  const session = useAsync(getSession, [sessionTry])

  useEffect(() => {
    if (session.error instanceof NeedsAuthError) {
      window.location.href = `${
        import.meta.env.VITE_AUTH_UI_URL
      }/login?return_to=${window.location.toString()}`
    } else if (session.error instanceof UnexpectedServerError) {
      const timeout = setTimeout(() => {
        setSessionTry((t) => t + 1)
      }, 1000)
      return () => {
        clearTimeout(timeout)
      }
    }
  }, [session.error])

  if (session.value) {
    return (
      <SessionContext.Provider value={session.value}>
        {children}
      </SessionContext.Provider>
    )
  }

  return (
    <Center h="100vh">
      <Spinner />
    </Center>
  )
}
