import {
  getEndTime,
  OffsetSoundLocation,
  padLocation,
  SoundLocation,
  SoundLocationWithBuffer,
} from './AudioEngine'

export interface PlayOptions {
  startSeek?: number
  clipStartFudge?: number
  clipEndFudge?: number
  verbose?: boolean
}

export type AudioScheduler = AsyncGenerator<void, void, number>

export type CreateAudioScheduler = (
  ctx: BaseAudioContext,
  destination: AudioNode,
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

// How far to schedule ahead of the current time
export const SCHEDULER_BUFFER_S = 2

export function playLocations(
  locs: OffsetSoundLocation[],
  {
    startSeek = 0,
    clipStartFudge = 0.05,
    clipEndFudge = 0.15,
    verbose = false,
  }: PlayOptions = {},
): AudioTask {
  if (!locs.length) {
    return { duration: 0, run: emptyScheduler }
  }

  let minTime = locs[0].start

  const duration = getEndTime(locs)! - minTime + clipStartFudge + clipEndFudge

  const scheduler: CreateAudioScheduler = async function* (
    ctx,
    destination,
    startTime,
    getBufferForLoc,
  ) {
    let currentTime = -Infinity
    let fetches = []
    for (const loc of locs) {
      const { source, start, end, offset } = loc

      // Time the buffer begins playing (at start of pre-start fudge)
      let queueTime =
        startTime + start + offset - minTime - startSeek - clipStartFudge

      // If we've generated up to the buffer threshold, wait for all pending
      // fetches to finish and pause until generation is triggered again.
      while (currentTime + SCHEDULER_BUFFER_S < queueTime) {
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
        const { start: bufferStart, buffer } = await getBufferForLoc(
          padLocation(loc, clipStartFudge, clipEndFudge),
          queueTime,
        )

        // The time the true clip region starts (after start fudge)
        // Paper over floating precision issues causing negative values
        const clipTime = queueTime + clipStartFudge + 0.0001

        const wordGainNode = ctx.createGain()
        wordGainNode.connect(destination)

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
          clipStart - clipStartFudge - bufferStart,
          clipDuration + clipStartFudge + clipEndFudge,
        )
      }
      fetches.push(queueWhenLoaded())

      if (verbose) console.log(source, queueTime, start, end)
    }

    await Promise.all(fetches)
  }

  return { duration, run: scheduler }
}
