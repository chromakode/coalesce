import {
  Button,
  Center,
  Link as ChakraLink,
  HStack,
  Heading,
  LinkBox,
  LinkOverlay,
  Spacer,
  Spinner,
  StackDivider,
  Text,
  VStack,
} from '@chakra-ui/react'
import { ProjectInfo } from '@shared/types'
import { formatRelative } from 'date-fns'
import { sortBy } from 'lodash-es'
import { useAsync, useAsyncFn } from 'react-use'
import { Link, useLocation } from 'wouter'
import { useAPI } from '../components/APIContext'
import { useSession } from '../components/SessionContext'

function ProjectItem({
  project: { projectId, title, tracks, createdAt },
}: {
  project: ProjectInfo
}) {
  const now = Date.now()
  const trackEntries = Object.entries(tracks)
  return (
    <LinkBox w="full">
      <HStack alignItems="baseline">
        <Heading>
          <Link href={`/project/${projectId}`}>
            <LinkOverlay>{title}</LinkOverlay>
          </Link>
        </Heading>
        <Spacer />
        <Text>{formatRelative(new Date(createdAt), now)}</Text>
      </HStack>
      <HStack>
        <Text>
          {trackEntries.length} tracks{trackEntries.length > 0 ? ':' : ''}
        </Text>
        {trackEntries.map(([trackId, { color, label }]) => (
          <Text key={trackId} color={`${color}.600`}>
            {label}
          </Text>
        ))}
      </HStack>
    </LinkBox>
  )
}

export default function IndexPage() {
  const session = useSession()
  const { createProject, listProjects } = useAPI()
  const projects = useAsync(listProjects, [])

  const [_, setLocation] = useLocation()
  const [createProjectStatus, handleCreateProject] = useAsyncFn(async () => {
    const newProject = await createProject()
    setLocation(`/project/${newProject.projectId}`)
  }, [])

  return (
    <Center h="100vh" bg="gray.50" flexDirection="column">
      {session && (
        <HStack position="absolute" top="4" right="4">
          <Text>
            Signed in as{' '}
            <ChakraLink href="/auth/settings">{session.email}</ChakraLink>.
          </Text>
          <ChakraLink href={session.logoutURL}>Logout</ChakraLink>
        </HStack>
      )}
      <Heading as="h1" size="2xl" mt="12" mb="8">
        Coalesce
      </Heading>
      {projects.loading ? (
        <Spinner />
      ) : projects.error ? (
        <Text>Error loading projects</Text>
      ) : (
        projects.value && (
          <Center
            w="container.lg"
            maxW="92vw"
            minH="50vh"
            mb="12"
            flexDirection="column"
            bg="white"
            borderRadius="xl"
            boxShadow="lg"
          >
            {projects.value?.length > 0 && (
              <VStack
                flex="1"
                w="full"
                p="8"
                spacing="4"
                divider={<StackDivider borderColor="gray.200" />}
                overflowX="auto"
              >
                {sortBy(projects.value, (p) => -new Date(p.createdAt)).map(
                  (project) => (
                    <ProjectItem key={project.projectId} project={project} />
                  ),
                )}
              </VStack>
            )}
            <Button
              fontSize="2xl"
              size="lg"
              colorScheme="green"
              m="8"
              onClick={handleCreateProject}
              isLoading={createProjectStatus.loading}
            >
              Create Project
            </Button>
          </Center>
        )
      )}
    </Center>
  )
}
