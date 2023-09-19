import { Center, Spinner } from '@chakra-ui/react'
import { Route, Switch } from 'wouter'
import { useSession } from './lib/session'
import IndexPage from './pages/IndexPage'
import ProjectPage from './pages/ProjectPage'

export default function App() {
  const session = useSession()
  return session ? (
    <Switch>
      <Route path="/">
        <IndexPage />
      </Route>
      <Route path="/project/:projectId">
        {({ projectId }) => <ProjectPage projectId={projectId} />}
      </Route>
    </Switch>
  ) : (
    <Center h="100vh">
      <Spinner />
    </Center>
  )
}
