import {
  Divider,
  FormControl,
  FormLabel,
  Icon,
  IconButton,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Switch,
  Text,
  useDisclosure,
  useOutsideClick,
} from '@chakra-ui/react'
import React, { useCallback, useRef } from 'react'
import { MdVolumeDownAlt, MdVolumeUp } from 'react-icons/md'
import { TrackMixerState } from '../lib/AudioMixer'

export interface TrackMixerSettings {
  gain?: number | 'auto'
}

export interface MixerSettings {
  tracks: Record<string, TrackMixerSettings>
}

export type OnUpdateTrackMixerSettings = (
  trackId: string,
  update: Partial<TrackMixerSettings>,
) => void

export function TrackVolumeControl({
  trackId,
  trackMixerState,
  trackMixerSettings,
  onUpdateTrackMixerSettings,
}: {
  trackId: string
  trackMixerState: TrackMixerState | null
  trackMixerSettings: TrackMixerSettings | null
  onUpdateTrackMixerSettings: OnUpdateTrackMixerSettings
}) {
  const contentRef = useRef<HTMLElement | null>(null)

  // When text is selected and lexical updates nodes within the selection,
  // Chakra gets a blur event and auto-closes the popover. As a workaround,
  // disable close on blur and manually close when the user clicks out.
  const { isOpen, onToggle, onClose } = useDisclosure()
  useOutsideClick({
    ref: contentRef,
    handler: onClose,
  })

  const actualGain = trackMixerState?.gain ?? 1
  const isAuto =
    trackMixerSettings?.gain == null || trackMixerSettings?.gain === 'auto'

  const handleChangeVolume = useCallback(
    (value: number) => {
      onUpdateTrackMixerSettings(trackId, { gain: value })
    },
    [trackId, onUpdateTrackMixerSettings],
  )

  const handleChangeVolumeAuto = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateTrackMixerSettings(trackId, {
        gain: ev.target.checked ? 'auto' : actualGain,
      })
    },
    [trackId, onUpdateTrackMixerSettings, actualGain],
  )

  return (
    <Popover
      placement="bottom"
      isOpen={isOpen}
      onClose={onClose}
      closeOnBlur={false}
    >
      <PopoverTrigger>
        <IconButton
          onClick={onToggle}
          icon={
            <Icon
              as={actualGain >= 1 ? MdVolumeUp : MdVolumeDownAlt}
              fontSize="2xl"
            />
          }
          aria-label="Track Volume"
          variant="ghost"
        />
      </PopoverTrigger>
      <PopoverContent ref={contentRef} w="20" boxShadow="md">
        <PopoverArrow />
        <PopoverBody display="flex" flexDirection="column" alignItems="center">
          <FormControl
            display="flex"
            flexDirection="column"
            alignItems="center"
          >
            <FormLabel m="0" mb="2">
              Auto
            </FormLabel>

            <Switch
              onChange={handleChangeVolumeAuto}
              isChecked={
                trackMixerSettings?.gain == null ||
                trackMixerSettings?.gain === 'auto'
              }
            />
          </FormControl>
          <Divider my="4" />
          <Slider
            orientation="vertical"
            minH="36"
            min={0}
            max={2.25}
            step={0.01}
            value={actualGain}
            onChange={handleChangeVolume}
            opacity={isAuto ? 0.5 : 1}
          >
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb />
          </Slider>
          <Text fontSize="md" fontWeight="medium" my="2">
            {Math.floor(actualGain * 100)}%
          </Text>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}
