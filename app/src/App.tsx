import { Route, Switch } from 'wouter'
import { RequireSession } from './components/SessionContext'
import IndexPage from './pages/IndexPage'
import ProjectPage from './pages/ProjectPage'

export default function App() {
  return (
    <Switch>
      <Route path="/">
        <RequireSession>
          <IndexPage />
        </RequireSession>
      </Route>
      <Route path="/project/:projectId">
        {({ projectId }) => <ProjectPage projectId={projectId} />}
      </Route>
    </Switch>
  )
}
