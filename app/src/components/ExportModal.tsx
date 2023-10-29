import {
  Button,
  Checkbox,
  Divider,
  HStack,
  Icon,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  Radio,
  RadioGroup,
  Text,
  VStack,
} from '@chakra-ui/react'
import { Project } from '@shared/types'
import { mapValues } from 'lodash-es'
import { ChangeEvent, useCallback, useState } from 'react'
import { MdAudioFile, MdFolderZip } from 'react-icons/md'

export enum ExportMode {
  Mixdown = 'mixdown',
  Separate = 'separate',
}

export interface ExportOptions {
  exportMode: ExportMode
  isRawMix: boolean
  selectedTracks: string[]
}

export function ExportModal({
  tracks,
  isExporting,
  progress,
  onExport,
  onClose,
}: {
  tracks: Project['tracks']
  isExporting: boolean
  progress: number
  onExport: (opts: ExportOptions) => void
  onClose: () => void
}) {
  const [exportMode, setExportMode] = useState(ExportMode.Mixdown)
  const [isRawMix, setRawMix] = useState(true)
  const [selectedTracks, setSelectedTracks] = useState<Record<string, boolean>>(
    () => mapValues(tracks, () => true),
  )

  const handleToggleTrack = useCallback((ev: ChangeEvent<HTMLInputElement>) => {
    setSelectedTracks((prevSelectedTracks) => ({
      ...prevSelectedTracks,
      [ev.target.name]: !prevSelectedTracks[ev.target.name],
    }))
  }, [])

  const handleToggleRawMix = useCallback(
    (ev: ChangeEvent<HTMLInputElement>) => {
      setRawMix(ev.target.checked)
    },
    [],
  )

  const handleExport = useCallback(() => {
    onExport({
      exportMode,
      isRawMix,
      selectedTracks: Object.entries(selectedTracks)
        .filter(([_, selected]) => selected)
        .map(([trackId]) => trackId),
    })
  }, [exportMode, tracks, selectedTracks])

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      closeOnOverlayClick={!isExporting}
      closeOnEsc={!isExporting}
      isCentered
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Export Audio</ModalHeader>
        {!isExporting && <ModalCloseButton />}
        <ModalBody>
          <RadioGroup
            onChange={setExportMode as (nextValue: string) => void}
            value={exportMode}
          >
            <VStack alignItems="flex-start">
              <Radio value={ExportMode.Mixdown}>
                <HStack>
                  <Icon as={MdAudioFile} fontSize="3xl" color="gray.600" />
                  <Text>Mix down into a single file</Text>
                </HStack>
              </Radio>
              <Radio value={ExportMode.Separate}>
                <HStack>
                  <Icon as={MdFolderZip} fontSize="3xl" color="gray.600" />
                  <Text>Separate file per track</Text>
                </HStack>
              </Radio>
              <VStack pl="16" pr="4" alignItems="flex-start" w="full">
                <Checkbox
                  isChecked={isRawMix}
                  onChange={handleToggleRawMix}
                  disabled={exportMode !== ExportMode.Separate}
                >
                  <Text>Export raw audio (no mixer gain)</Text>
                </Checkbox>
                <Divider />
                {Object.values(tracks).map((track) => (
                  <Checkbox
                    key={track.trackId}
                    name={track.trackId}
                    isChecked={selectedTracks[track.trackId]}
                    onChange={handleToggleTrack}
                    disabled={exportMode !== ExportMode.Separate}
                  >
                    <Text color={`${track.color}.600`}>
                      {track.label ?? 'Speaker'}
                    </Text>
                  </Checkbox>
                ))}
              </VStack>
            </VStack>
          </RadioGroup>
          <Progress mt="4" value={progress} max={1} />
        </ModalBody>
        <ModalFooter>
          {!isExporting && (
            <Button variant="ghost" mr={3} onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button
            colorScheme="green"
            onClick={handleExport}
            isLoading={isExporting}
          >
            Export to .wav
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
