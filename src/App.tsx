import {
  Box,
  Flex,
  HStack,
  Icon,
  IconButton,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
} from '@chakra-ui/react'
import { groupBy } from 'lodash-es'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { MdAudioFile, MdPause, MdPlayArrow } from 'react-icons/md'
import { useAsync } from 'react-use'
import { Region } from 'wavesurfer.js/dist/plugins/regions'
import './App.css'
import AudioEngine, {
  AudioEngineStatus,
  exportWAV,
  OffsetSoundLocation,
  padLocation,
  SoundLocation,
} from './AudioEngine'
import { playLocations } from './AudioScheduler'
import { DisplayMS } from './DisplayMS'
import Editor, { EditorMetrics, EditorRef, SoundNodeData } from './Editor'
import { ExportModal } from './ExportModal'
import { IntroModal } from './IntroModal'
import { LoadingCover } from './LoadingCover'
import { loadProject, Project } from './project'
import { WaveEditor } from './WaveEditor'

const WAVE_PADDING = 0.5
const MAX_WAVE_NODES = 10

function useEngine(): AudioEngine {
  const [engine] = useState(() => new AudioEngine())
  return engine
}

function useEngineStatus(engine: AudioEngine): AudioEngineStatus {
  const [state, setState] = useState(engine.status)
  useEffect(() => {
    engine.events.on('status', setState)
    return () => {
      engine.events.off('status', setState)
    }
  })
  return state
}

export default function App() {
  const engine = useEngine()
  const engineStatus = useEngineStatus(engine)
  const editorRef = useRef<EditorRef | null>(null)
  const [selection, setSelection] = useState<{
    locs: SoundLocation[]
    nodes: SoundNodeData[]
  } | null>(null)
  const [isLoaded, setLoaded] = useState(false)
  const [project, setProject] = useState<Project | null>(null)
  const [metrics, setMetrics] = useState<EditorMetrics>()
  const [curTimeMS, setCurTimeMS] = useState(0)
  const [showExport, setShowExport] = useState(false)
  const [isExporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [showIntro, setShowIntro] = useState(false)

  const playbackTime =
    engineStatus.mode === 'playing'
      ? curTimeMS + engineStatus.playbackTime
      : curTimeMS

  useEffect(() => {
    async function load() {
      let project: Project
      try {
        project = await loadProject()
      } catch (err) {
        console.warn('Unable to load project:', err)
        setLoaded(true)
        setShowIntro(true)
        return
      }
      engine.setProject(project)
      setProject(project)
      setLoaded(true)
    }
    load()
  }, [engine])

  const handleLocPlaying = (loc: SoundLocation, isPlaying: boolean) => {
    if (!loc.key) {
      return
    }
    editorRef.current?.setSoundNodePlaying(loc.key, isPlaying)
  }

  const play = (locs: OffsetSoundLocation[], startOffsetMS = 0) => {
    try {
      engine.start(
        playLocations(locs, {
          startSeek: startOffsetMS / 1000,
          onLocPlaying: handleLocPlaying,
        }),
      )
    } catch (err) {
      console.warn(err)
    }
  }

  const handleSelect = (
    locs: OffsetSoundLocation[],
    nodes: SoundNodeData[],
  ) => {
    play(locs)
    setSelection({ locs, nodes })
    // FIXME: I'd like to make the seek bar reflect the playback, but getting
    // the time for a node is really hard. We'd need to somehow bookkeep all of
    // the timeline transformations to know which location it got coalesced
    // into, and where it was offset.
  }

  const handlePlayToggle = () => {
    if (engineStatus.mode === 'playing') {
      setCurTimeMS((curTimeMS) => curTimeMS + engineStatus.playbackTime)
      engine.stop()
    } else {
      const editor = editorRef.current
      if (editor) {
        play(editor.getAllSoundLocations(), curTimeMS)
      }
    }
  }

  const handleSeek = (newTimeMS: number) => {
    setCurTimeMS(newTimeMS)
    const editor = editorRef.current
    if (engineStatus.mode !== 'stopped' && editor) {
      play(editor.getAllSoundLocations(), newTimeMS)
    }
  }

  const handleUpdateRegion = (loc: SoundLocation, region: Region) => {
    editorRef.current?.updateSoundNode(region.id, {
      start: loc.start + region.start,
      end: loc.start + region.end,
    })
  }

  const handleClickExport = () => {
    engine.stop()
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
        engine,
        playLocations(locs, { onLocPlaying: handleLocPlaying }),
        setExportProgress,
      )

      if (!outputURL) {
        // TODO: toast error
        setExporting(false)
        return
      }

      const a = document.createElement('a')
      a.href = outputURL
      a.download = 'export.wav'
      a.click()
      URL.revokeObjectURL(outputURL)

      setShowExport(false)
      setExporting(false)
      setExportProgress(0)
    }

    doExport()
  }

  const selectionBuffers = useAsync(async () => {
    if (!selection) {
      return []
    }

    const { locs } = selection
    return Promise.all(
      locs.map((l) =>
        engine.getBufferForLoc(padLocation(l, WAVE_PADDING, WAVE_PADDING)),
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
              ({ soundLoc: { source, start, end } }) =>
                source === lineSource && start >= l.start && end <= l.end,
            )
            .map(({ key, text, soundLoc: { start, end } }) => ({
              id: key,
              content: text.trim(),
              start: start - l.start,
              end: end - l.start,
            }))

          const color = project?.tracks[l.source].color

          return (
            <WaveEditor
              key={l.start}
              buffer={l.buffer}
              regions={regions}
              waveColor={color ?? 'black'}
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
  }, [selection, deferredSelectionBuffers])

  return (
    <Flex h="100vh" flexDir="column" bg="gray.100">
      {!isLoaded && <LoadingCover />}
      {showExport && (
        <ExportModal
          isExporting={isExporting}
          progress={exportProgress}
          onExport={handleExport}
          onClose={handleDismissExport}
        />
      )}
      {showIntro && <IntroModal />}
      <Box flex="1" overflow="auto" pb="10rem">
        {project && (
          <Editor
            ref={editorRef}
            project={project}
            onSelect={handleSelect}
            onMetricsUpdated={setMetrics}
          />
        )}
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
        <Slider
          aria-label="Playback progress"
          min={0}
          max={metrics?.durationMS}
          value={playbackTime}
          onChange={handleSeek}
        >
          <SliderTrack>
            <SliderFilledTrack />
          </SliderTrack>
          <SliderThumb />
        </Slider>
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
