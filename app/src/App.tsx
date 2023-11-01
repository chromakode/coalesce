import { useToast } from '@chakra-ui/react'
import { useEffect } from 'react'
import { Route, Switch } from 'wouter'
import { useAPI } from './components/APIContext'
import { WithSession } from './components/SessionContext'
import IndexPage from './pages/IndexPage'
import ProjectPage from './pages/ProjectPage'

const SITE_NOTICE = import.meta.env.VITE_SITE_NOTICE.split('|')

export default function App() {
  const { hasGuestKey } = useAPI()

  const toast = useToast()
  useEffect(() => {
    if (SITE_NOTICE) {
      toast({
        title: SITE_NOTICE[0],
        description: SITE_NOTICE[1],
        position: 'bottom-right',
        isClosable: true,
        duration: 8 * 1000,
        containerStyle: {
          marginBottom: '9rem',
          width: '24rem',
        },
      })
    }
  }, [])

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
