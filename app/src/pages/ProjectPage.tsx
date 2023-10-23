import {
  Box,
  Button,
  Center,
  Container,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Icon,
  IconButton,
  Input,
  InputGroup,
  InputLeftAddon,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Spinner,
  Switch,
  Text,
  VStack,
  useBoolean,
} from '@chakra-ui/react'
import { Project, SoundLocation } from '@shared/types'
import assertNever from 'assert-never'
import { saveAs } from 'file-saver'
import { AnimatePresence } from 'framer-motion'
import JSZip from 'jszip'
import {
  cloneDeep,
  debounce,
  get,
  groupBy,
  mapValues,
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
import { useAsync, useLatest, useLocalStorage } from 'react-use'
import ReconnectingWebSocket from 'reconnecting-websocket'
import slugify from 'slugify'
import { Region } from 'wavesurfer.js/dist/plugins/regions'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { useAPI } from '../components/APIContext'
import { AppHeader } from '../components/AppHeader'
import { CollaborateButton } from '../components/CollaborateButton'
import CollaboratorPosition from '../components/CollaboratorPosition'
import { DisplayMS } from '../components/DisplayMS'
import Editor, {
  EditorMetrics,
  EditorRef,
  SoundNodeData,
} from '../components/Editor'
import {
  ExportModal,
  ExportMode,
  ExportOptions,
} from '../components/ExportModal'
import { LoadingCover } from '../components/LoadingCover'
import MotionBox from '../components/MotionBox'
import TracksForm from '../components/TracksForm'
import { WaveEditor } from '../components/WaveEditor'
import AudioEngine, {
  AudioEngineStatus,
  OffsetSoundLocation,
  decibelsToGain,
  exportWAV,
  getTimeFromNodeKey,
  padLocation,
} from '../lib/AudioEngine'
import { playLocations } from '../lib/AudioScheduler'

import {
  MixerSettings,
  OnUpdateTrackMixerSettings,
} from '../components/TrackVolumeControl'
import { MixerState } from '../lib/AudioMixer'
import './ProjectPage.css'

const WAVE_PADDING = 0.75
const MAX_WAVE_NODES = 10

export interface CollaboratorState {
  id: number
  name: string
  color: string
  playbackTime: number
  playbackStatus: AudioEngineStatus['mode']
}

function useSocket(projectId: string): Project | null {
  const { projectSocket } = useAPI()
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

function useMixerSettings(project: Project | null) {
  const [settingsDoc, setMixerSettingsDoc] = useState<Y.Map<any> | undefined>()
  const [mixerSettings, setMixerSettings] = useState<MixerSettings>({
    tracks: {},
  })

  useEffect(() => {
    if (!settingsDoc) {
      return
    }

    function handleUpdate() {
      setMixerSettings(settingsDoc!.toJSON() as MixerSettings)
    }

    settingsDoc.observeDeep(handleUpdate)
    return () => {
      settingsDoc.unobserveDeep(handleUpdate)
    }
  }, [settingsDoc])

  const mixerState = useMemo<MixerState>(
    () => ({
      tracks: mapValues(project?.tracks, (track, trackId) => {
        // Default source gains to normalize track volumes
        const gainSetting = mixerSettings.tracks[trackId]?.gain ?? 'auto'
        const gain =
          gainSetting === 'auto'
            ? decibelsToGain(-(track.audio?.maxDBFS ?? 0))
            : gainSetting
        return { gain }
      }),
    }),

    [project, mixerSettings],
  )

  const updateTrackMixerSettings: OnUpdateTrackMixerSettings = useCallback(
    (trackId, update) => {
      if (!settingsDoc) {
        return
      }

      let trackMap = settingsDoc.get('tracks')
      if (!trackMap) {
        trackMap = new Y.Map()
        settingsDoc.set('tracks', trackMap)
      }

      let trackData = trackMap.get(trackId)
      if (!trackData) {
        trackData = new Y.Map()
        trackMap.set(trackId, trackData)
      }

      for (const [key, val] of Object.entries(update)) {
        trackData?.set(key, val)
      }
    },
    [settingsDoc],
  )

  return {
    mixerState,
    mixerSettings,
    setMixerSettingsDoc,
    updateTrackMixerSettings,
  }
}

function useEngine(
  project: Project | null,
  mixerSettings: MixerState,
): AudioEngine | null {
  const api = useAPI()
  const [engine, setEngine] = useState<AudioEngine | null>(null)

  useEffect(() => {
    setEngine(project ? new AudioEngine(api, project, mixerSettings) : null)
  }, [project, api])

  useEffect(() => {
    if (engine) {
      engine.updateMixerSettings(mixerSettings)
    }
  }, [engine, mixerSettings])

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
  const { updateProject } = useAPI()
  const project = useSocket(projectId)
  const {
    mixerState,
    mixerSettings,
    setMixerSettingsDoc,
    updateTrackMixerSettings,
  } = useMixerSettings(project)
  const engine = useEngine(project, mixerState)
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
  const [isAutoscroll, setAutoscroll] = useBoolean()
  const latestAutoscroll = useLatest(isAutoscroll)
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
    if (tracks.length === 0) {
      setEditingTracks.on()
    }
  }, [project, setEditingTracks])

  const throttledScrollToKey = useMemo(
    () =>
      throttle(
        (key: string) => {
          if (latestAutoscroll.current) {
            editorRef.current?.scrollToKey(key)
          }
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

  const handleOnSync = ({
    isSynced,
    mixerSettingsDoc,
  }: {
    isSynced: boolean
    mixerSettingsDoc: Y.Map<unknown>
  }) => {
    setIsInitialSynced((isInitialSynced) => isSynced || isInitialSynced)
    setMixerSettingsDoc(mixerSettingsDoc)
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

  const handleSelect = ({
    locs,
    nodes,
    nearestNodeKey,
  }: {
    nearestNodeKey: string | null
    locs: OffsetSoundLocation[]
    nodes: SoundNodeData[]
  }) => {
    setSelection({ locs, nodes })

    if (nearestNodeKey) {
      const locTime = getTimeFromNodeKey(
        metrics?.nodeKeyToLoc ?? {},
        nearestNodeKey,
      )
      if (locTime != null) {
        setCurTimeMS(locTime * 1000)
      }
    }

    if (!locs.length) {
      engine?.stop()
      return
    }

    play(locs, { startOffsetMS: locs[0].start + locs[0].offset, scroll: false })
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

  const handleExport = ({
    exportMode,
    isRawMix,
    selectedTracks,
  }: ExportOptions) => {
    const editor = editorRef.current
    if (!editor || !project) {
      return
    }

    const locs = editor.getAllSoundLocations()
    const slug = (text: string) =>
      slugify(text, {
        remove: /[*+~.()'"!:@$]/g,
      })
    const title = slug(project!.title)

    async function doExportMixdown() {
      const blob = await exportWAV({
        engine: engine!,
        mixerState: !isRawMix ? mixerState : null,
        task: playLocations(locs, {
          startSeek: metrics!.start,
        }),
        onProgress: setExportProgress,
      })

      const outputURL = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = outputURL
      a.download = `${title}.wav`
      a.click()

      URL.revokeObjectURL(outputURL)
    }

    async function doExportTracks(selectedTracks: string[]) {
      const zip = JSZip()
      const trackLocs = groupBy(locs, ({ source }) => source)

      let exportedCount = 0
      for (const { label, trackId } of Object.values(project!.tracks)) {
        if (!selectedTracks.includes(trackId)) {
          continue
        }

        const blob = await exportWAV({
          engine: engine!,
          mixerState: !isRawMix ? mixerState : null,
          task: playLocations(trackLocs[trackId], {
            startSeek: metrics!.start,
          }),
          onProgress: (progress) => {
            setExportProgress(
              (exportedCount + progress) / selectedTracks.length,
            )
          },
        })

        zip.file(`${title}-${slug(label ?? 'Speaker')}-${trackId}.wav`, blob)
        exportedCount++
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      await saveAs(zipBlob, `${slug(project!.title)}.zip`)
    }

    async function doExport() {
      setExporting(true)

      try {
        if (exportMode === ExportMode.Mixdown) {
          await doExportMixdown()
        } else if (exportMode === ExportMode.Separate) {
          await doExportTracks(selectedTracks)
        } else {
          assertNever(exportMode)
        }
      } catch (err) {
        setExporting(false)
        return
      }

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
      <HStack key={lineSource} margin="auto">
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

  const hasTracks = project && Object.keys(project.tracks).length > 0
  const hasTranscriptions = hasTracks && metrics

  return (
    <Flex h="100vh" flexDir="column" bg="gray.100">
      {(!project || (hasTracks && !isInitialSynced)) && <LoadingCover />}
      {showExport && project && (
        <ExportModal
          tracks={project.tracks}
          isExporting={isExporting}
          progress={exportProgress}
          onExport={handleExport}
          onClose={handleDismissExport}
        />
      )}
      <AnimatePresence>
        {collaboratorStates.length > 0 && (
          <MotionBox
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            overflow="hidden"
            zIndex="overlay"
          >
            <HStack
              px="4"
              py="2"
              justifyContent="space-between"
              fontSize="md"
              bg="green.600"
              shadow="0 0 5px rgba(0, 0, 0, .15)"
            >
              <HStack color="brand.light">
                <Icon as={MdGroup} fontSize="2xl" />
                <Text fontWeight="medium">
                  Editing collaboratively with:{' '}
                  {collaboratorStates.map(({ name }) => name).join(', ')}
                </Text>
              </HStack>
              <InputGroup
                size="sm"
                w="64"
                bg="gray.50"
                borderRadius="full"
                overflow="hidden"
              >
                <InputLeftAddon fontSize="md" bg="gray.200" pl="4">
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
        <AppHeader />
        <Box
          // Relative position so absolutely-positioned Lexical collab cursors /
          // selections scroll with the text
          position="relative"
          ref={scrollerRef}
        >
          {project && (
            <Container maxW="container.lg" pt="16" px="6">
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
                  <HStack ml="4">
                    <CollaborateButton project={project} />
                    {hasTracks && (
                      <Button
                        leftIcon={
                          isEditingTracks ? (
                            <Icon fontSize="2xl" as={MdCheck} />
                          ) : (
                            <Icon fontSize="2xl" as={MdEdit} />
                          )
                        }
                        colorScheme={isEditingTracks ? 'green' : 'gray'}
                        aria-label={
                          isEditingTracks
                            ? 'Finish editing tracks'
                            : 'Edit tracks'
                        }
                        onClick={setEditingTracks.toggle}
                      >
                        Edit tracks
                      </Button>
                    )}
                  </HStack>
                </Flex>
                <TracksForm
                  project={project}
                  isReadOnly={!isEditingTracks}
                  mixerState={mixerState}
                  mixerSettings={mixerSettings}
                  onUpdateTrackMixerSettings={updateTrackMixerSettings}
                />
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
                {isInitialSynced && !hasTranscriptions && (
                  <Center mt="16" opacity=".5">
                    <Spinner size="lg" mr="4" />
                    <Text>Waiting for transcriptions...</Text>
                  </Center>
                )}
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
        <Popover trigger="hover" placement="top-start" offset={[-8, 8]}>
          <PopoverTrigger>
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
          </PopoverTrigger>
          <PopoverContent w="auto" boxShadow="md">
            <PopoverArrow />
            <PopoverBody display="flex" p="4">
              <FormControl display="flex" alignItems="center">
                <Switch onChange={setAutoscroll.toggle} />
                <FormLabel mb="0" pl="2" cursor="pointer">
                  Auto-scroll with playback
                </FormLabel>
              </FormControl>
            </PopoverBody>
          </PopoverContent>
        </Popover>
        <DisplayMS ms={playbackTime} />
        <Box flex="1" position="relative">
          <Slider
            aria-label="Playback progress"
            min={(metrics?.start ?? 0) * 1000}
            max={(metrics?.duration ?? 0) * 1000}
            value={playbackTime}
            onChange={handleSeek}
            focusThumbOnChange={false}
          >
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb bg="blue.600" />
            {collaboratorStates.map((s) => (
              <CollaboratorPosition key={s.id} collaboratorState={s} />
            ))}
          </Slider>
        </Box>
        {metrics && <DisplayMS ms={metrics.duration * 1000} />}
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
