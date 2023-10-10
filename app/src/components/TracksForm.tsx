import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
  Center,
  Collapse,
  Flex,
  Icon,
  IconButton,
  Input,
  Progress,
  Text,
  VStack,
  useDisclosure,
} from '@chakra-ui/react'
import { TRACK_COLOR_ORDER } from '@shared/constants'
import { JobInfo, Project, Track } from '@shared/types'
import { uniqBy } from 'lodash'
import { debounce, groupBy, partition, sortBy } from 'lodash-es'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { MdAudioFile, MdClose } from 'react-icons/md'
import { useBeforeUnload } from 'react-use'
import { useAPI } from './APIContext'

function jobProgress(jobs: JobInfo[] | null, task: JobInfo['task']): number {
  if (!jobs) {
    return 0
  }

  const job = jobs.find(({ task: jobTask }) => jobTask === task)
  if (!job) {
    return 0
  }

  if (job.state.status === 'complete') {
    return 1
  }

  if (job.state.status === 'running') {
    return job.state.progress
  }

  return 0
}

function getCurrentTaskLabel(
  isUploading: boolean,
  jobs: JobInfo[] | null,
): string | null {
  if (isUploading) {
    return 'Uploading'
  }

  if (!jobs) {
    return null
  }

  if (jobs.every(({ state: { status } }) => status === 'complete')) {
    return null
  }

  if (jobs.some(({ state: { status } }) => status === 'failed')) {
    return 'Error'
  }

  const currentTasks = jobs.filter(
    ({ state: { status } }) => status === 'running',
  )
  if (currentTasks.length) {
    return currentTasks
      .map(({ task }) => (task === 'process' ? 'Processing' : 'Unknown'))
      .join(' & ')
  }

  if (jobs.some(({ state: { status } }) => status === 'queued')) {
    return 'Queued'
  }

  return null
}

function TrackUpload({
  project,
  file,
  track,
  jobs,
  color,
  isReadOnly,
  onRemoveFile,
}: {
  project: Project
  file?: File | null
  track: Track | null
  jobs: JobInfo[] | null
  color: string
  isReadOnly: boolean
  onRemoveFile: (filename: string) => void
}) {
  const { deleteTrack, updateTrack, uploadTrack } = useAPI()
  const {
    isOpen: isRemoveConfirmOpen,
    onOpen: handleRemoveClick,
    onClose: onDismissRemoveConfirm,
  } = useDisclosure()
  const cancelRemoveRef = useRef<HTMLButtonElement>(null)

  const trackIdRef = useRef<string>()
  const labelRef = useRef<string>()

  // TODO handle errors
  const [uploadProgress, setUploadProgress] = useState(track ? 1 : 0)
  const uploadRef = useRef<ReturnType<typeof uploadTrack>>()
  useEffect(() => {
    if (uploadRef.current || !file) {
      return
    }
    uploadRef.current = uploadTrack(project.projectId, file, setUploadProgress)
    uploadRef.current.result.then(({ trackId }) => {
      trackIdRef.current = trackId
      uploadRef.current = undefined
      if (labelRef.current) {
        updateTrack(project.projectId, trackId, {
          label: labelRef.current,
        })
      }
    })
  }, [file])

  const isUploading = useCallback(() => uploadRef.current != null, [])
  useBeforeUnload(isUploading, `Cancel upload of ${file?.name}?`)

  const handleRemove = useCallback(() => {
    uploadRef.current?.abort()

    if (file) {
      onRemoveFile(file.name)
    }

    if (track) {
      deleteTrack(project.projectId, track.trackId)
    }
  }, [file])

  const handleChangeLabel = useMemo(
    () =>
      debounce((ev: React.ChangeEvent<HTMLInputElement>) => {
        const label = ev.target.value
        labelRef.current = label

        if (track) {
          updateTrack(project.projectId, track.trackId, {
            label,
          })
        }
      }, 500),
    [track],
  )

  const progress = 0.2 * uploadProgress + 0.8 * jobProgress(jobs, 'process')
  const currentTaskLabel = getCurrentTaskLabel(uploadProgress < 1, jobs)

  const isRunning =
    jobs != null && jobs.some(({ state }) => state.status === 'running')

  return (
    <Flex flexDir="column" w="full" bg="gray.50" p="2" borderRadius="md">
      <Flex
        w="full"
        gap="2"
        fontSize="lg"
        alignItems="center"
        justifyContent="center"
      >
        <Icon
          as={MdAudioFile}
          fontSize="4xl"
          color={!isRunning ? 'gray.600' : 'blue.600'}
          alignSelf="center"
        />
        <Flex minW="0" flex="1" alignItems="baseline">
          {currentTaskLabel && (
            <Text
              mr="2"
              fontWeight="bold"
              color={currentTaskLabel === 'Error' ? 'red.700' : 'blue.600'}
            >
              {currentTaskLabel}
            </Text>
          )}
          <Text
            flex="1"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            title={file?.name ?? track?.originalFilename}
          >
            {file?.name ?? track?.originalFilename}
          </Text>
          {isReadOnly ? (
            <Text color={color} mx="4">
              {track?.label}
            </Text>
          ) : (
            <Input
              placeholder="Enter speaker name"
              variant="flushed"
              w="20ch"
              mx="4"
              size="sm"
              fontSize="lg"
              color={color}
              defaultValue={track?.label ?? ''}
              onChange={handleChangeLabel}
            />
          )}
        </Flex>
        {!isReadOnly && (
          <IconButton
            icon={<Icon as={MdClose} fontSize="2xl" />}
            aria-label="Remove Track"
            colorScheme="red"
            variant="ghost"
            onClick={handleRemoveClick}
          />
        )}
        <AlertDialog
          isOpen={isRemoveConfirmOpen}
          leastDestructiveRef={cancelRemoveRef}
          onClose={onDismissRemoveConfirm}
        >
          <AlertDialogOverlay>
            <AlertDialogContent>
              <AlertDialogHeader fontSize="lg" fontWeight="bold">
                Remove track?
              </AlertDialogHeader>
              <AlertDialogBody>
                Removing the track "{track?.label ?? track?.originalFilename}"
                will remove the track's text from the document.
              </AlertDialogBody>
              <AlertDialogFooter>
                <Button ref={cancelRemoveRef} onClick={onDismissRemoveConfirm}>
                  Cancel
                </Button>
                <Button colorScheme="red" onClick={handleRemove} ml={3}>
                  Remove track
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogOverlay>
        </AlertDialog>
      </Flex>
      <Collapse in={progress > 0 && progress < 1}>
        <Progress
          w="full"
          mt="2"
          mx="1"
          min={0}
          max={1}
          value={progress}
          sx={{
            '& > div:first-child': {
              transitionProperty: 'width',
              transitionTimingFunction: 'linear',
            },
          }}
          hasStripe={isRunning}
          isAnimated={isRunning}
        />
      </Collapse>
    </Flex>
  )
}

export default function TracksForm({
  project,
  isReadOnly,
}: {
  project: Project
  isReadOnly: boolean
}) {
  const { tracks } = project
  const [files, setFiles] = useState<File[]>([])

  const handleDrop = useCallback((acceptedFiles: File[]) => {
    setFiles((curFiles) => uniqBy([...curFiles, ...acceptedFiles], 'name'))
  }, [])

  const handleRemove = useCallback((filename: string) => {
    setFiles((curFiles) => curFiles.filter(({ name }) => name !== filename))
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: {
      'audio/wav': ['.wav'],
      'audio/mp3': ['.mp3'],
      'audio/flac': ['.flac'],
    },
  })

  const [sortedTracks, trackKeys] = React.useMemo(() => {
    const remoteTracks = Object.values(tracks).map((track) => ({
      type: 'track',
      key: track.originalFilename,
      track,
      file: null,
    }))
    const trackKeys = new Set(remoteTracks.map((t) => t.key))
    const notUploadedYet = files
      .filter(({ name }) => !trackKeys.has(name))
      .map((file) => ({
        type: 'file',
        key: file.name,
        file,
        track: null,
      }))
    const sortedTracks = sortBy([...remoteTracks, ...notUploadedYet], 'key')
    return [sortedTracks, trackKeys]
  }, [tracks, files])

  const availableColors = React.useMemo(() => {
    const usedColors = new Set(Object.values(tracks).map(({ color }) => color))
    return TRACK_COLOR_ORDER.filter((c) => !usedColors.has(c))
  }, [tracks])

  // When tracks arrive in the project state, remove our local state for the file.
  useEffect(() => {
    const [uploaded, notUploadedYet] = partition(files, ({ name }) =>
      trackKeys.has(name),
    )
    if (uploaded.length) {
      setFiles(notUploadedYet)
    }
  }, [files, trackKeys])

  const jobsForTrack = React.useMemo(
    () => groupBy(Object.values(project.jobs), 'trackId'),
    [project.jobs],
  )

  const colors = [...availableColors]
  return (
    <VStack w="full" alignItems="stretch">
      {sortedTracks.map(({ key, track, file }) => (
        <TrackUpload
          key={key}
          project={project}
          file={file}
          track={track}
          jobs={track ? jobsForTrack[track.trackId] : null}
          color={`${track ? track.color : colors.shift()}.600`}
          isReadOnly={isReadOnly}
          onRemoveFile={handleRemove}
        />
      ))}
      <Collapse in={!isReadOnly}>
        <Center
          {...getRootProps()}
          h="24"
          bg="gray.100"
          borderWidth="2px"
          borderColor={isDragActive ? 'green.400' : 'gray.400'}
          borderStyle="dashed"
          boxShadow={isDragActive ? 'md' : 'none'}
          cursor="pointer"
        >
          <input {...getInputProps()} />
          <Text color="gray.600">
            Drag and drop audio here, or click to upload...
          </Text>
        </Center>
      </Collapse>
    </VStack>
  )
}
