import { Center, Spinner } from '@chakra-ui/react'
import { SessionInfo } from '@shared/types'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { useAsync } from 'react-use'
import { NeedsAuthError, UnexpectedServerError } from '../lib/api'
import { useAPI } from './APIContext'

const SessionContext = createContext<SessionInfo | null>(null)
export const useSession = () => useContext(SessionContext)

export function WithSession({
  isRequired,
  children,
}: {
  isRequired?: boolean
  children: React.ReactNode
}) {
  const { getSession } = useAPI()
  const [sessionTry, setSessionTry] = useState(0)
  const session = useAsync(getSession, [sessionTry])

  useEffect(() => {
    if (session.error instanceof NeedsAuthError) {
      if (isRequired) {
        window.location.href = `${
          import.meta.env.VITE_AUTH_UI_URL
        }/login?return_to=${window.location.toString()}`
      }
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
  } else if (!isRequired && session.error instanceof NeedsAuthError) {
    return (
      <SessionContext.Provider value={null}>{children}</SessionContext.Provider>
    )
  }

  return (
    <Center h="100vh">
      <Spinner />
    </Center>
  )
}
