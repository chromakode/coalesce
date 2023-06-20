import { Route, Switch } from 'wouter'
import IndexPage from './pages/IndexPage'
import ProjectPage from './pages/ProjectPage'

export default function App() {
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
}
