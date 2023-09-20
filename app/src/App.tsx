import { Center, Spinner } from '@chakra-ui/react'
import { useAsync } from 'react-use'
import { Route, Switch } from 'wouter'
import { getSession } from './lib/api'
import IndexPage from './pages/IndexPage'
import ProjectPage from './pages/ProjectPage'

export default function App() {
  const session = useAsync(getSession, [])

  if (session.loading) {
    return (
      <Center h="100vh">
        <Spinner />
      </Center>
    )
  } else if (session.value) {
    return (
      <Switch>
        <Route path="/">
          <IndexPage />
        </Route>
        <Route path="/project/:projectId">
          {({ projectId }) => <ProjectPage projectId={projectId} />}
        </Route>
      </Switch>
    )
  } else {
    window.location.href = `${
      import.meta.env.VITE_AUTH_UI_URL
    }/login?return_to=${window.location.toString()}`
  }
}
