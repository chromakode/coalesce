import { Route, Switch } from 'wouter'
import { useAPI } from './components/APIContext'
import { WithSession } from './components/SessionContext'
import IndexPage from './pages/IndexPage'
import ProjectPage from './pages/ProjectPage'

export default function App() {
  const { hasGuestKey } = useAPI()
  return (
    <Switch>
      <Route path="/home">
        <WithSession isRequired>
          <IndexPage />
        </WithSession>
      </Route>
      <Route path="/project/:projectId">
        {({ projectId }) => (
          <WithSession isRequired={!hasGuestKey}>
            <ProjectPage projectId={projectId} />
          </WithSession>
        )}
      </Route>
    </Switch>
  )
}
