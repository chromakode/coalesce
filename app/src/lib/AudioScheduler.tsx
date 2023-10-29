import { SoundLocation } from '@shared/types'
import {
  getEndTime,
  OffsetSoundLocation,
  padLocation,
  SoundLocationWithBuffer,
} from './AudioEngine'
import { AudioMixer } from './AudioMixer'

export interface PlayOptions {
  startSeek?: number
  clipStartFudge?: number
  clipEndFudge?: number
  bufferSeconds?: number
  verbose?: boolean
  onLocPlaying?: (loc: SoundLocation, isPlaying: boolean) => void
}

export type AudioScheduler = AsyncGenerator<void, void, number>

export type CreateAudioScheduler = (
  ctx: BaseAudioContext,
  mixer: AudioMixer | null,
  startTime: number,
  getBufferForLoc: (
    loc: SoundLocation,
    deadline: number,
  ) => Promise<SoundLocationWithBuffer>,
) => AudioScheduler

export interface AudioTask {
  duration: number
  run: CreateAudioScheduler
}

const emptyScheduler: CreateAudioScheduler = async function* () {}

// Fade in and out durations to add to clips played
export const DEFAULT_START_FUDGE = 0.05
export const DEFAULT_END_FUDGE = 0.15

// How far to schedule ahead of the current time
export const SCHEDULER_BUFFER_S = 2

export function playLocations(
  locs: OffsetSoundLocation[],
  {
    startSeek = 0,
    clipStartFudge = DEFAULT_START_FUDGE,
    clipEndFudge = DEFAULT_END_FUDGE,
    bufferSeconds = SCHEDULER_BUFFER_S,
    verbose = false,
    onLocPlaying,
  }: PlayOptions = {},
): AudioTask {
  if (!locs.length) {
    return { duration: 0, run: emptyScheduler }
  }

  const duration = getEndTime(locs)! - startSeek - clipStartFudge + clipEndFudge

  const scheduler: CreateAudioScheduler = async function* (
    ctx,
    mixer,
    startTime,
    getBufferForLoc,
  ) {
    let playingTimeouts = new Set<number>()
    let playingLocs = new Set<SoundLocation>()
    const queueLocPlaying = (
      loc: SoundLocation,
      start: number,
      end: number,
    ) => {
      playingTimeouts.add(
        window.setTimeout(() => {
          onLocPlaying!(loc, true)
          playingLocs.add(loc)
        }, Math.max(0, start - ctx.currentTime) * 1000),
      )
      playingTimeouts.add(
        window.setTimeout(() => {
          onLocPlaying!(loc, false)
          playingLocs.delete(loc)
        }, Math.max(0, end - ctx.currentTime) * 1000),
      )
    }

    let currentTime = -Infinity
    let fetches = []
    try {
      for (const loc of locs) {
        const { source, start, end, offset } = loc

        // Clamp start fudge to beginning of audio data
        const clampedStartFudge = Math.min(start, clipStartFudge)

        // Time the buffer begins playing (at start of pre-start fudge)
        let queueTime =
          startTime + start + offset - startSeek - clampedStartFudge

        // If we've generated up to the buffer threshold, wait for all pending
        // fetches to finish and pause until generation is triggered again.
        while (currentTime + bufferSeconds < queueTime) {
          if (fetches.length) {
            await Promise.all(fetches)
          }
          currentTime = yield
          fetches = []
        }

        let clipStart = start
        let clipDuration = end - start

        // If clip starts before current time, skip or truncate.
        if (queueTime < currentTime) {
          const preStartOffset = queueTime - currentTime

          clipDuration += preStartOffset
          if (clipDuration <= 0) {
            continue
          }

          queueTime = currentTime
          clipStart -= preStartOffset
        }

        const queueWhenLoaded = async () => {
          // If a mixer was provided but returns no destination, it's probably
          // already been destroyed. Skip loading and playback.
          const mixerDestination = mixer?.getTrackDestination(source)
          if (mixer && !mixerDestination) {
            return
          }

          const { start: bufferStart, buffer } = await getBufferForLoc(
            padLocation(loc, clampedStartFudge, clipEndFudge),
            queueTime,
          )

          // If no mixer was provided, we're preloading the audio. Skip playback
          // after loading the buffer.
          if (!mixerDestination) {
            return
          }

          // The time the true clip region starts (after start fudge)
          // Paper over floating precision issues causing negative values
          const clipTime = queueTime + clampedStartFudge + 0.0001

          const wordGainNode = ctx.createGain()
          wordGainNode.connect(mixerDestination)

          const bufNode = ctx.createBufferSource()
          bufNode.buffer = buffer
          bufNode.connect(wordGainNode)

          wordGainNode.gain.setValueAtTime(0, queueTime)
          wordGainNode.gain.linearRampToValueAtTime(1, clipTime)
          wordGainNode.gain.setValueAtTime(1, clipTime + clipDuration)
          wordGainNode.gain.linearRampToValueAtTime(
            0,
            clipTime + clipDuration + clipEndFudge,
          )
          bufNode.start(
            queueTime,
            clipStart - clampedStartFudge - bufferStart,
            clipDuration + clampedStartFudge + clipEndFudge,
          )

          if (onLocPlaying) {
            if (loc.key) {
              queueLocPlaying(loc, clipTime, clipTime + clipDuration)
            } else if (loc.children) {
              for (const childLoc of loc.children) {
                if (childLoc.end < clipStart) {
                  continue
                }
                const childStart = clipTime + childLoc.start - clipStart
                const childDuration = childLoc.end - childLoc.start
                queueLocPlaying(
                  childLoc,
                  childStart,
                  childStart + childDuration,
                )
              }
            }
          }
        }
        fetches.push(queueWhenLoaded())

        if (verbose) console.log(source, queueTime, start, end)
      }

      await Promise.all(fetches)

      // Pause until halted by engine (so timeouts persist until end)
      while (true) {
        yield
      }
    } finally {
      if (onLocPlaying) {
        playingTimeouts.forEach(window.clearTimeout)
        playingLocs.forEach((loc) => {
          onLocPlaying(loc, false)
        })
      }
    }
  }

  return { duration, run: scheduler }
}
