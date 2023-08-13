import {
  Button,
  Center,
  Heading,
  HStack,
  LinkBox,
  LinkOverlay,
  Spinner,
  StackDivider,
  Text,
  VStack,
} from '@chakra-ui/react'
import { ProjectInfo } from '@shared/types'
import { useAsync, useAsyncFn } from 'react-use'
import { Link, useLocation } from 'wouter'
import { createProject, listProjects } from '../lib/api'

function ProjectItem({
  project: { projectId, title, tracks },
}: {
  project: ProjectInfo
}) {
  const trackEntries = Object.entries(tracks)
  return (
    <LinkBox w="full">
      <Heading>
        <Link href={`/project/${projectId}`}>
          <LinkOverlay>{title}</LinkOverlay>
        </Link>
      </Heading>
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

export default function IndexList() {
  const [_, setLocation] = useLocation()
  const projects = useAsync(listProjects, [])
  const [createProjectStatus, handleCreateProject] = useAsyncFn(async () => {
    const newProject = await createProject()
    setLocation(`/project/${newProject.projectId}`)
  }, [])

  return (
    <Center h="100vh" bg="gray.50" flexDirection="column">
      <Heading as="h1" size="2xl" mb="4">
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
            p="8"
            flexDirection="column"
            bg="white"
            borderRadius="xl"
            boxShadow="lg"
          >
            {projects.value?.length > 0 && (
              <VStack
                flex="1"
                w="full"
                spacing="4"
                divider={<StackDivider borderColor="gray.200" />}
              >
                {projects.value.map((project) => (
                  <ProjectItem key={project.projectId} project={project} />
                ))}
              </VStack>
            )}
            <Button
              fontSize="2xl"
              size="lg"
              colorScheme="green"
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
