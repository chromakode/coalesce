import {
  Center,
  Collapse,
  Flex,
  Icon,
  IconButton,
  Input,
  Progress,
  Text,
  VStack,
} from '@chakra-ui/react'
import { JobInfo, Project, Track } from '@shared/types'
import { uniqBy } from 'lodash'
import { debounce, groupBy, partition, sortBy } from 'lodash-es'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { MdAudioFile, MdClose } from 'react-icons/md'
import { deleteTrack, updateTrack, uploadTrack } from '../lib/api'
import { COLOR_ORDER } from './Editor'

function jobProgress(
  hasResult: boolean,
  jobs: JobInfo[] | null,
  task: JobInfo['task'],
): number {
  if (hasResult) {
    return 1
  }

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

  const currentTasks = jobs.filter(
    ({ state: { status } }) => status === 'running',
  )
  if (currentTasks.length) {
    return currentTasks
      .map(({ task }) =>
        task === 'transcribe' ? 'Transcribing' : 'Preprocessing',
      )
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
  const trackIdRef = useRef<string>()
  const nameRef = useRef<string>()

  // TODO handle errors
  const [uploadProgress, setUploadProgress] = useState(track ? 1 : 0)
  const uploadRef = useRef<ReturnType<typeof uploadTrack>>()
  useEffect(() => {
    if (uploadRef.current || !file) {
      return
    }
    uploadRef.current = uploadTrack(project.id, file, setUploadProgress)
    uploadRef.current.result.then(({ id: trackId }) => {
      trackIdRef.current = trackId
      updateTrack(project.id, trackId, {
        name: nameRef.current,
        originalFilename: file.name,
      })
    })
  }, [file])

  const handleRemove = useCallback(() => {
    uploadRef.current?.abort()

    if (file) {
      onRemoveFile(file.name)
    }

    if (track) {
      deleteTrack(project.id, track.id)
    }
  }, [file])

  const handleChangeName = useMemo(
    () =>
      debounce((ev: React.ChangeEvent<HTMLInputElement>) => {
        const name = ev.target.value
        nameRef.current = name

        if (track) {
          updateTrack(project.id, track.id, {
            name,
            originalFilename: track?.originalFilename,
          })
        }
      }, 500),
    [uploadProgress],
  )

  const progress =
    0.2 * uploadProgress +
    0.2 * jobProgress(track?.audio != null, jobs, 'chunks') +
    0.6 * jobProgress(track?.words != null, jobs, 'transcribe')

  const currentTaskLabel = getCurrentTaskLabel(uploadProgress < 1, jobs)

  const isRunning =
    jobs != null && jobs.some(({ state }) => state.status === 'running')
  const isFinished = progress === 1 && !currentTaskLabel

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
          color={progress !== 1 ? 'blue.600' : 'gray.600'}
          alignSelf="center"
        />
        <Flex minW="0" flex="1" alignItems="baseline">
          {currentTaskLabel && (
            <Text mr="2" fontWeight="bold" color="blue.600">
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
              {track?.name}
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
              defaultValue={track?.name}
              onChange={handleChangeName}
            />
          )}
        </Flex>
        {!isReadOnly && (
          <IconButton
            icon={<Icon as={MdClose} fontSize="2xl" />}
            aria-label="Remove Track"
            colorScheme="red"
            variant="ghost"
            onClick={handleRemove}
          />
        )}
      </Flex>
      <Collapse in={!isFinished}>
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
    () => groupBy(Object.values(project.jobs), 'track'),
    [project.jobs],
  )

  const colors = [...COLOR_ORDER]
  return (
    <VStack w="full" alignItems="stretch">
      {sortedTracks.map(({ type, key, track, file }) => (
        <TrackUpload
          key={key}
          project={project}
          file={file}
          track={track}
          jobs={track ? jobsForTrack[track.id] : null}
          color={colors.shift() ?? 'black'}
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
