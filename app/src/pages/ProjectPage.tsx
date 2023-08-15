import {
  Alert,
  AlertIcon,
  AlertTitle,
  Box,
  Center,
  Container,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  InputGroup,
  InputLeftAddon,
  Slider,
  SliderFilledTrack,
  SliderMark,
  SliderThumb,
  SliderTrack,
  Spinner,
  Text,
  Tooltip,
  VStack,
  useBoolean,
} from '@chakra-ui/react'
import { Project, SoundLocation } from '@shared/types'
import { AnimatePresence } from 'framer-motion'
import {
  cloneDeep,
  debounce,
  every,
  get,
  groupBy,
  merge,
  set,
  throttle,
  unset,
} from 'lodash-es'
import {
  ChangeEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  MdAudioFile,
  MdCheck,
  MdEdit,
  MdGroup,
  MdPause,
  MdPlayArrow,
} from 'react-icons/md'
import { useAsync, useLocalStorage } from 'react-use'
import ReconnectingWebSocket from 'reconnecting-websocket'
import slugify from 'slugify'
import { Region } from 'wavesurfer.js/dist/plugins/regions'
import { WebsocketProvider } from 'y-websocket'
import { DisplayMS } from '../components/DisplayMS'
import Editor, {
  EditorMetrics,
  EditorRef,
  SoundNodeData,
} from '../components/Editor'
import { ExportModal } from '../components/ExportModal'
import { LoadingCover } from '../components/LoadingCover'
import MotionBox from '../components/MotionBox'
import TracksForm from '../components/TracksForm'
import { WaveEditor } from '../components/WaveEditor'
import AudioEngine, {
  AudioEngineStatus,
  OffsetSoundLocation,
  exportWAV,
  getTimeFromNodeKey,
  padLocation,
} from '../lib/AudioEngine'
import { playLocations } from '../lib/AudioScheduler'
import { projectSocket, updateProject } from '../lib/api'
import './ProjectPage.css'

const WAVE_PADDING = 0.5
const MAX_WAVE_NODES = 10

interface CollaboratorState {
  id: number
  name: string
  color: string
  playbackTime: number
  playbackStatus: AudioEngineStatus['mode']
}

function useSocket(projectId: string): Project | null {
  const socketRef = useRef<{
    projectId: string
    ws: ReconnectingWebSocket
  } | null>(null)
  const [project, setProject] = useState<Project | null>(null)

  useEffect(() => {
    // Reuse socket ref across hot reloads
    if (!socketRef.current || socketRef.current.projectId !== projectId) {
      socketRef.current?.ws.close()
      socketRef.current = { projectId, ws: projectSocket(projectId) }
    }

    const { ws } = socketRef.current
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'project:data') {
        setProject(msg.data)
      } else if (msg.type === 'project:update') {
        setProject((prevData) => {
          if (prevData == null) {
            console.warn('received update for unknown project', msg)
            return null
          }
          const nextData = cloneDeep(prevData)
          if (msg.path) {
            if (msg.data === null) {
              unset(nextData, msg.path)
            } else {
              set(nextData, msg.path, merge(get(nextData, msg.path), msg.data))
            }
          } else {
            merge(nextData, msg.data)
          }
          return nextData
        })
      }
    }
  }, [projectId])

  return project
}

function useEngine(project: Project | null): AudioEngine | null {
  const [engine, setEngine] = useState<AudioEngine | null>(null)
  useEffect(() => {
    setEngine(project ? new AudioEngine(project) : null)
  }, [project])
  return engine
}

function useEngineStatus(engine: AudioEngine | null): AudioEngineStatus {
  const [state, setState] = useState<AudioEngineStatus>(
    engine ? engine.status : { mode: 'uninitialized' },
  )
  useEffect(() => {
    engine?.events.on('status', setState)
    return () => {
      engine?.events.off('status', setState)
    }
  }, [engine])
  return state
}

export default function ProjectPage({ projectId }: { projectId: string }) {
  const project = useSocket(projectId)
  const engine = useEngine(project)
  const engineStatus = useEngineStatus(engine)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorRef | null>(null)
  const awarenessRef = useRef<WebsocketProvider['awareness'] | null>(null)
  const [isInitialSynced, setIsInitialSynced] = useState(false)
  const [selection, setSelection] = useState<{
    locs: SoundLocation[]
    nodes: SoundNodeData[]
  } | null>(null)
  const [metrics, setMetrics] = useState<EditorMetrics>()
  const [curTimeMS, setCurTimeMS] = useState(0)
  const [showExport, setShowExport] = useState(false)
  const [isExporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [isEditingTracks, setEditingTracks] = useBoolean()
  const [nickname, setNickname] = useLocalStorage('collabNick', 'Anonymous')
  const [initialNickname] = useState(() => nickname)
  const [collaboratorStates, setCollaboratorStates] = useState<
    CollaboratorState[]
  >([])

  const playbackTime =
    engineStatus.mode === 'playing'
      ? curTimeMS + engineStatus.playbackTime
      : curTimeMS

  useEffect(() => {
    if (!project) {
      return
    }
    const tracks = Object.values(project?.tracks)
    if (tracks.length === 0 || tracks.some(({ words }) => words == null)) {
      setEditingTracks.on()
    }
  }, [project, setEditingTracks])

  const throttledScrollToKey = useMemo(
    () =>
      throttle(
        (key: string) => {
          editorRef.current?.scrollToKey(key)
        },
        1000,
        { leading: false, trailing: true },
      ),
    [],
  )

  const handleLocPlaying = (
    loc: SoundLocation,
    isPlaying: boolean,
    scroll: boolean,
  ) => {
    const { key } = loc
    if (!key) {
      return
    }

    editorRef.current?.setSoundNodePlaying(key, isPlaying)

    if (scroll && isPlaying) {
      throttledScrollToKey(key)
    }
  }

  const play = (
    locs: OffsetSoundLocation[],
    { startOffsetMS = 0, scroll = false },
  ) => {
    try {
      engine?.start(
        playLocations(locs, {
          startSeek: startOffsetMS / 1000,
          onLocPlaying: (loc: SoundLocation, isPlaying: boolean) =>
            handleLocPlaying(loc, isPlaying, scroll),
        }),
      )
    } catch (err) {
      console.warn(err)
    }
  }

  const handleOnSync = (isSynced: boolean) => {
    setIsInitialSynced((isInitialSynced) => isSynced || isInitialSynced)
  }

  const handleAwareness = useCallback(
    (awareness: WebsocketProvider['awareness']) => {
      awarenessRef.current = awareness

      const times = []
      for (const [id, state] of awareness.getStates().entries()) {
        if (id === awareness.clientID) {
          continue
        }
        times.push({
          id,
          name: state.name.length ? state.name : 'Anonymous',
          color: state.color,
          playbackTime: state.playbackTime,
          playbackStatus: state.playbackStatus,
        })
      }
      setCollaboratorStates(times)
    },
    [],
  )

  useEffect(() => {
    awarenessRef.current?.setLocalStateField('name', nickname)
  }, [nickname])

  useEffect(() => {
    awarenessRef.current?.setLocalStateField('playbackTime', playbackTime)
  }, [playbackTime])

  useEffect(() => {
    const { mode } = engineStatus
    let playbackStatus
    if (mode === 'playing' || mode === 'loading') {
      playbackStatus = 'playing'
    } else {
      playbackStatus = 'stopped'
    }
    awarenessRef.current?.setLocalStateField('playbackStatus', playbackStatus)
  }, [engineStatus])

  const handleSelect = (
    locs: OffsetSoundLocation[],
    nodes: SoundNodeData[],
  ) => {
    setSelection({ locs, nodes })

    if (!locs.length) {
      return
    }

    play(locs, { scroll: false })

    const locTime = getTimeFromNodeKey(
      metrics?.nodeKeyToLoc ?? {},
      nodes[0].key,
    )
    if (locTime != null) {
      setCurTimeMS(locTime * 1000)
    }
  }

  const handlePlayToggle = () => {
    if (engineStatus.mode === 'playing') {
      setCurTimeMS((curTimeMS) => curTimeMS + engineStatus.playbackTime)
      engine?.stop()
    } else {
      const editor = editorRef.current
      if (editor) {
        play(editor.getAllSoundLocations(), {
          startOffsetMS: curTimeMS,
          scroll: true,
        })
      }
    }
  }
  useHotkeys('shift+space', handlePlayToggle, {
    enableOnContentEditable: true,
    preventDefault: true,
  })

  const handleSeek = (newTimeMS: number) => {
    setCurTimeMS(newTimeMS)
    const editor = editorRef.current
    if (engineStatus.mode !== 'stopped' && editor) {
      play(editor.getAllSoundLocations(), {
        startOffsetMS: newTimeMS,
        scroll: true,
      })
    }
  }

  const handleUpdateRegion = (loc: SoundLocation, region: Region) => {
    editorRef.current?.updateSoundNode(region.id, {
      start: loc.start + region.start,
      end: loc.start + region.end,
    })
  }

  const handleClickExport = () => {
    engine?.stop()
    setShowExport(true)
  }

  const handleDismissExport = () => {
    setShowExport(false)
  }

  const handleExport = () => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    const locs = editor.getAllSoundLocations()

    async function doExport() {
      setExporting(true)

      const outputURL = await exportWAV(
        engine!,
        playLocations(locs),
        setExportProgress,
      )

      if (!outputURL) {
        // TODO: toast error
        setExporting(false)
        return
      }

      const slug = slugify(project!.title, {
        remove: /[*+~.()'"!:@$]/g,
      })

      const a = document.createElement('a')
      a.href = outputURL
      a.download = `${slug}.wav`
      a.click()
      URL.revokeObjectURL(outputURL)

      setShowExport(false)
      setExporting(false)
      setExportProgress(0)
    }

    doExport()
  }

  const handleProjectNameChange = useMemo(
    () =>
      debounce((ev: ChangeEvent<HTMLInputElement>) => {
        updateProject(projectId, { title: ev.target.value })
      }, 500),
    [],
  )

  const handleChangeNick = useCallback(
    (ev: ChangeEvent<HTMLInputElement>) => {
      setNickname(ev.target.value)
    },
    [setNickname],
  )

  const selectionBuffers = useAsync(async () => {
    if (!selection) {
      return []
    }

    const { locs } = selection
    return Promise.all(
      locs.map((l) =>
        engine!.getBufferForLoc(padLocation(l, WAVE_PADDING, WAVE_PADDING)),
      ),
    )
  }, [selection])

  const deferredSelectionBuffers = useDeferredValue(selectionBuffers)
  const waves = useMemo(() => {
    if (
      !selection ||
      deferredSelectionBuffers.loading ||
      deferredSelectionBuffers.error
    ) {
      return []
    }

    const { nodes } = selection

    const locsBySource = groupBy(deferredSelectionBuffers.value, 'source')

    if (Object.keys(locsBySource).length > 1 || nodes.length > MAX_WAVE_NODES) {
      return []
    }

    return Object.entries(locsBySource).map(([lineSource, locs]) => (
      <HStack key={lineSource}>
        {locs.map((l) => {
          // FIXME: inefficient multi pass filtering
          const regions = nodes
            .filter(
              ({ soundSource: source, soundStart: start, soundEnd: end }) =>
                source === lineSource && start >= l.start && end <= l.end,
            )
            .map(({ key, text, soundStart: start, soundEnd: end }) => ({
              id: key,
              content: text.trim(),
              start: start - l.start,
              end: end - l.start,
            }))

          const color = project!.tracks[lineSource].color ?? 'black'

          return (
            <WaveEditor
              key={l.start}
              buffer={l.buffer}
              regions={regions}
              waveColor={color}
              minPxPerSec={800}
              cursorWidth={0}
              fillParent={false}
              interact={false}
              onRegionUpdated={(region) => handleUpdateRegion(l, region)}
            />
          )
        })}
      </HStack>
    ))
  }, [deferredSelectionBuffers])

  const bottomWavePadding = waves.length > 0 ? '10rem' : ''

  const hasTranscription =
    project != null &&
    Object.keys(project.tracks).length > 0 &&
    every(project.tracks, (t) => t.words != null)

  return (
    <Flex h="100vh" flexDir="column" bg="gray.100">
      {(!project || (hasTranscription && !isInitialSynced)) && <LoadingCover />}
      {showExport && (
        <ExportModal
          isExporting={isExporting}
          progress={exportProgress}
          onExport={handleExport}
          onClose={handleDismissExport}
        />
      )}
      <AnimatePresence>
        {collaboratorStates.length > 0 && (
          <MotionBox
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            zIndex="overlay"
          >
            <HStack
              px="4"
              py="2"
              justifyContent="space-between"
              fontSize="md"
              bg="gray.100"
              borderBottomWidth="1px"
              borderColor="gray.400"
              shadow="0 0 5px rgba(0, 0, 0, .15)"
            >
              <HStack color="green.800">
                <Icon as={MdGroup} fontSize="xl" />
                <Text>
                  Editing collaboratively with:{' '}
                  {collaboratorStates.map(({ name }) => name).join(', ')}
                </Text>
              </HStack>
              <InputGroup size="sm" w="64" bg="gray.50">
                <InputLeftAddon fontSize="md" bg="gray.200">
                  Your name:
                </InputLeftAddon>
                <Input
                  fontSize="md"
                  value={nickname}
                  onChange={handleChangeNick}
                />
              </InputGroup>
            </HStack>
          </MotionBox>
        )}
      </AnimatePresence>
      <Box flex="1" overflow="auto" pb={bottomWavePadding}>
        <Box
          // Relative position so absolutely-positioned Lexical collab cursors /
          // selections scroll with the text
          position="relative"
          ref={scrollerRef}
        >
          {project && (
            <Container maxW="container.lg" pt="24">
              <VStack>
                <Flex w="full">
                  {isEditingTracks ? (
                    <Input
                      flex="1"
                      fontSize="3xl"
                      fontWeight="bold"
                      variant="flushed"
                      defaultValue={project.title}
                      onChange={handleProjectNameChange}
                      mb="2"
                    />
                  ) : (
                    <Text flex="1" fontSize="3xl" fontWeight="bold">
                      {project.title}
                    </Text>
                  )}
                  {hasTranscription && (
                    <IconButton
                      fontSize="2xl"
                      icon={
                        isEditingTracks ? (
                          <Icon as={MdCheck} />
                        ) : (
                          <Icon as={MdEdit} />
                        )
                      }
                      colorScheme={isEditingTracks ? 'green' : 'gray'}
                      variant={isEditingTracks ? 'solid' : 'ghost'}
                      ml="4"
                      aria-label={
                        isEditingTracks
                          ? 'Finish editing tracks'
                          : 'Edit tracks'
                      }
                      onClick={setEditingTracks.toggle}
                    />
                  )}
                </Flex>
                {isEditingTracks && hasTranscription && (
                  <Alert status="warning">
                    <AlertIcon />
                    <AlertTitle>
                      Removing tracks will delete the track's text.
                    </AlertTitle>
                  </Alert>
                )}
                <TracksForm project={project} isReadOnly={!isEditingTracks} />
              </VStack>
              <Box
                w="full"
                minH="70vh"
                bg="white"
                my="6"
                py="4"
                px="6"
                fontSize="xl"
                fontWeight="normal"
                borderRadius="lg"
                sx={{
                  '& h1': {
                    fontWeight: 'bold',
                    fontSize: '1.5em',
                    marginTop: '2rem',
                    marginBottom: '.5rem',
                  },
                  '& h2': {
                    fontWeight: 'bold',
                    fontSize: '1.15em',
                    marginTop: '2rem',
                    marginBottom: '.5rem',
                  },
                }}
              >
                {hasTranscription ? (
                  <Editor
                    ref={editorRef}
                    scrollerRef={scrollerRef}
                    project={project}
                    initialNickname={initialNickname ?? 'Anonymous'}
                    onSync={handleOnSync}
                    onAwareness={handleAwareness}
                    onSelect={handleSelect}
                    onMetricsUpdated={setMetrics}
                  />
                ) : (
                  <Center mt="16" opacity=".5">
                    <Spinner size="lg" mr="4" />
                    <Text>Waiting for transcriptions...</Text>
                  </Center>
                )}
              </Box>
            </Container>
          )}
        </Box>
      </Box>
      {waves.length > 0 && (
        <Flex
          position="absolute"
          bottom="4rem"
          left="0"
          right="0"
          m="4"
          justifyContent="center"
          borderWidth="2px"
          borderColor="gray.400"
          borderRadius="lg"
          overflowX="auto"
          bg="whiteAlpha.800"
          backdropFilter="auto"
          backdropBlur="md"
          shadow="md"
          zIndex="overlay"
        >
          {waves}
        </Flex>
      )}
      <HStack
        px={4}
        py={3}
        spacing={4}
        bg="gray.100"
        borderTopWidth="1px"
        borderColor="gray.400"
        shadow="0 0 5px rgba(0, 0, 0, .15)"
        zIndex="overlay"
      >
        <IconButton
          colorScheme="blue"
          aria-label="Play"
          fontSize="2xl"
          borderRadius="full"
          icon={
            engineStatus.mode === 'playing' ? (
              <Icon as={MdPause} />
            ) : (
              <Icon as={MdPlayArrow} />
            )
          }
          onClick={handlePlayToggle}
          isLoading={engineStatus.mode === 'loading'}
        />
        <DisplayMS ms={playbackTime} />
        <Box flex="1" position="relative">
          <Slider
            aria-label="Playback progress"
            min={0}
            max={metrics?.durationMS}
            value={playbackTime}
            onChange={handleSeek}
            focusThumbOnChange={false}
          >
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb bg="blue.600" />
            {collaboratorStates.map(
              ({ id, name, color, playbackTime, playbackStatus }) => (
                <Tooltip
                  key={id}
                  isOpen
                  hasArrow
                  aria-hidden
                  bgColor={color}
                  label={
                    <HStack spacing={1}>
                      <Icon
                        fontSize="md"
                        // Compensate for a lil extra padding from the icon
                        ml="-.1rem"
                        as={
                          playbackStatus === 'playing' ? MdPlayArrow : MdPause
                        }
                      />
                      <Text>{name}</Text>
                    </HStack>
                  }
                  fontSize="xs"
                  arrowSize={8}
                  offset={[0, 12]}
                >
                  <SliderMark value={playbackTime}>
                    <Box
                      w={2}
                      h={2}
                      mt={-1}
                      borderRadius="full"
                      bgColor={color}
                    ></Box>
                  </SliderMark>
                </Tooltip>
              ),
            )}
          </Slider>
        </Box>
        {metrics && <DisplayMS ms={metrics.durationMS} />}
        <IconButton
          colorScheme="green"
          variant="outline"
          aria-label="Play"
          fontSize="2xl"
          icon={<Icon as={MdAudioFile} />}
          onClick={handleClickExport}
        />
      </HStack>
    </Flex>
  )
}
