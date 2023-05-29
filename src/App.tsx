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
import { useEffect, useMemo, useRef, useState } from 'react'
import { MdAudioFile, MdPause, MdPlayArrow } from 'react-icons/md'
import { Region } from 'wavesurfer.js/dist/plugins/regions'
import './App.css'
import AudioEngine, {
  exportWAV,
  OffsetSoundLocation,
  padLocation,
  playLocations,
  SoundLocation,
} from './audio'
import { DisplayMS, DisplaySinceMS } from './DisplayMS'
import Editor, { EditorMetrics, EditorRef, SoundNodeData } from './Editor'
import { ExportModal } from './ExportModal'
import { IntroModal } from './IntroModal'
import { LoadingCover } from './LoadingCover'
import { loadProject, Project } from './project'
import { WaveEditor } from './WaveEditor'

const WAVE_PADDING = 0.5
const MAX_WAVE_NODES = 30

export default function App() {
  const [engine] = useState(() => new AudioEngine())
  const editorRef = useRef<EditorRef | null>(null)
  const [selection, setSelection] = useState<{
    locs: SoundLocation[]
    nodes: SoundNodeData[]
  } | null>(null)
  const [isLoaded, setLoaded] = useState(false)
  const [project, setProject] = useState<Project | null>(null)
  const [metrics, setMetrics] = useState<EditorMetrics>()
  const [curTimeMS, setCurTimeMS] = useState(0)
  const [playStartMS, setPlayStartMS] = useState<number | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [isExporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [showIntro, setShowIntro] = useState(false)

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
      setProject(project)
      await engine.loadProject(project)
      setLoaded(true)
    }
    load()
  }, [engine])

  const stop = () => {
    setPlayStartMS(null)
    engine.stop()
  }

  const play = (locs: OffsetSoundLocation[], startTimeMS = 0) => {
    engine.stop()
    try {
      playLocations(engine, engine.ctx, locs, {
        startTime: startTimeMS / 1000,
        onFinish: stop,
      })
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
    if (playStartMS != null) {
      setCurTimeMS((curTime) => curTime + Date.now() - playStartMS)
      stop()
    } else {
      const editor = editorRef.current
      if (editor) {
        setPlayStartMS(Date.now())
        play(editor.getAllSoundLocations(), curTimeMS)
      }
    }
  }

  const handleSeek = (newTimeMS: number) => {
    setCurTimeMS(newTimeMS)
    const editor = editorRef.current
    if (playStartMS != null && editor) {
      setPlayStartMS(Date.now())
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

      const outputURL = await exportWAV(engine, locs, {
        onProgress: setExportProgress,
      })

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

  const waves = useMemo(() => {
    if (!selection) {
      return []
    }

    const { nodes, locs } = selection
    const locsWithBuffer = locs.map((l) =>
      engine.getBufferForLoc(padLocation(l, WAVE_PADDING)),
    )

    const locsBySource = groupBy(locsWithBuffer, 'source')

    if (Object.keys(locsBySource).length > 1 || nodes.length > MAX_WAVE_NODES) {
      return []
    }

    return Object.entries(locsBySource).map(([lineSource, locs]) => (
      <div key={lineSource} className="wave-row">
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
      </div>
    ))
  }, [selection])

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
            playStartMS != null ? (
              <Icon as={MdPause} />
            ) : (
              <Icon as={MdPlayArrow} />
            )
          }
          onClick={handlePlayToggle}
        />
        {playStartMS ? (
          <DisplaySinceMS start={curTimeMS} since={playStartMS} />
        ) : (
          <DisplayMS ms={curTimeMS} />
        )}
        <Slider
          aria-label="Playback progress"
          min={0}
          max={metrics?.durationMS}
          value={curTimeMS}
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
