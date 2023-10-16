import {
  Button,
  Center,
  Container,
  Flex,
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
import { AppHeader } from '../components/AppHeader'

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
  const { createProject, listProjects } = useAPI()
  const projects = useAsync(listProjects, [])

  const [_, setLocation] = useLocation()
  const [createProjectStatus, handleCreateProject] = useAsyncFn(async () => {
    const newProject = await createProject()
    setLocation(`/project/${newProject.projectId}`)
  }, [])

  return (
    <Center h="100vh" bg="brand.light" flexDirection="column">
      {projects.loading ? (
        <Spinner />
      ) : projects.error ? (
        <Text>Error loading projects</Text>
      ) : (
        projects.value && (
          <Flex
            flex="1"
            flexDirection="column"
            w="full"
            alignItems="center"
            overflow="hidden"
          >
            <AppHeader />
            <Container
              flex="1"
              mt="8"
              p="8"
              bg="white"
              borderRadius="xl"
              boxShadow="lg"
              maxW="container.lg"
              flexDirection="column"
              overflowY="auto"
            >
              {projects.value?.length > 0 && (
                <VStack
                  spacing="4"
                  divider={<StackDivider borderColor="gray.200" />}
                >
                  {sortBy(projects.value, (p) => -new Date(p.createdAt)).map(
                    (project) => (
                      <ProjectItem key={project.projectId} project={project} />
                    ),
                  )}
                </VStack>
              )}
            </Container>
            <Button
              flexShrink="0"
              fontSize="2xl"
              size="lg"
              p="8"
              colorScheme="green"
              m="8"
              onClick={handleCreateProject}
              isLoading={createProjectStatus.loading}
            >
              Create Project
            </Button>
          </Flex>
        )
      )}
    </Center>
  )
}
