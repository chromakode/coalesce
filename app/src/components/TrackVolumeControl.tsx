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
} from '@chakra-ui/react'
import React, { useCallback } from 'react'
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
    <Popover placement="bottom">
      <PopoverTrigger>
        <IconButton
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
      <PopoverContent w="20" boxShadow="md">
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
