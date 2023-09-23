import { Center, Spinner } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { useAsync } from 'react-use'
import { Route, Switch } from 'wouter'
import { NeedsAuthError, UnexpectedServerError, getSession } from './lib/api'
import IndexPage from './pages/IndexPage'
import ProjectPage from './pages/ProjectPage'

export default function App() {
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
      <Switch>
        <Route path="/">
          <IndexPage session={session.value} />
        </Route>
        <Route path="/project/:projectId">
          {({ projectId }) => <ProjectPage projectId={projectId} />}
        </Route>
      </Switch>
    )
  }

  return (
    <Center h="100vh">
      <Spinner />
    </Center>
  )
}
