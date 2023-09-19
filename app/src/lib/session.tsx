import { Configuration, FrontendApi, Session } from '@ory/client'
import { useEffect, useState } from 'react'

const ory = new FrontendApi(
  new Configuration({
    basePath: import.meta.env.VITE_KRATOS_URL,
    baseOptions: {
      withCredentials: true,
    },
  }),
)

export function useSession() {
  const [session, setSession] = useState<Session | false | undefined>()
  useEffect(() => {
    ory
      .toSession()
      .then(({ data }) => {
        setSession(data)
      })
      .catch((err) => {
        console.error('Error fetching session', err)
        window.location.href = `${
          import.meta.env.VITE_AUTH_UI_URL
        }/login?return_to=${window.location.toString()}`
      })
  }, [])

  return session
}
