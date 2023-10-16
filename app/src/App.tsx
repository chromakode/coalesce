import { Route, Switch } from 'wouter'
import { RequireSession } from './components/SessionContext'
import IndexPage from './pages/IndexPage'
import ProjectPage from './pages/ProjectPage'

export default function App() {
  return (
    <Switch>
      <RequireSession>
        <Route path="/">
          <IndexPage />
        </Route>
        <Route path="/project/:projectId">
          {({ projectId }) => <ProjectPage projectId={projectId} />}
        </Route>
      </RequireSession>
    </Switch>
  )
}
