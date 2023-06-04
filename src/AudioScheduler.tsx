import AudioEngine, { getEndTime, OffsetSoundLocation } from './AudioEngine'

export interface PlayOptions {
  startSeek?: number
  clipStartFudge?: number
  endFudge?: number
  verbose?: boolean
}

export type AudioScheduler = Generator<void, void, number>

export type CreateAudioScheduler = (
  engine: AudioEngine,
  ctx: BaseAudioContext,
  destination: AudioNode,
  startTime: number,
) => AudioScheduler

export interface AudioTask {
  duration: number
  run: CreateAudioScheduler
}

const emptyScheduler: CreateAudioScheduler = function* () {}

export function playLocations(
  locs: OffsetSoundLocation[],
  {
    startSeek = 0,
    clipStartFudge = 0.05,
    endFudge = 0.15,
    verbose = false,
  }: PlayOptions = {},
): AudioTask {
  if (!locs.length) {
    return { duration: 0, run: emptyScheduler }
  }

  let minTime = locs[0].start

  const duration = getEndTime(locs)! - minTime + clipStartFudge + endFudge

  const scheduler: CreateAudioScheduler = function* (
    engine,
    ctx,
    destination,
    startTime,
  ) {
    let generateUntil = yield
    for (const { source, start, end, offset } of locs) {
      let playTime = startTime + start + offset - minTime - startSeek

      // Pause generator until the next event.
      while (generateUntil < playTime) {
        generateUntil = yield
      }

      let clipStart = start
      let clipDuration = end - start

      // If clip starts before startTime, skip or truncate.
      if (playTime < startTime) {
        const preStartOffset = playTime - startTime

        clipDuration += preStartOffset
        if (clipDuration <= 0) {
          continue
        }

        playTime = startTime
        clipStart -= preStartOffset
      }

      playTime += clipStartFudge + 0.0001 // Paper over floating precision issues causing negative values

      const buffer = engine.getBuffer(source)

      const wordGainNode = ctx.createGain()
      wordGainNode.connect(destination)

      const bufNode = ctx.createBufferSource()
      bufNode.buffer = buffer
      bufNode.connect(wordGainNode)

      wordGainNode.gain.setValueAtTime(0, playTime - clipStartFudge)
      wordGainNode.gain.linearRampToValueAtTime(1, playTime)
      wordGainNode.gain.setValueAtTime(1, playTime + clipDuration)
      wordGainNode.gain.linearRampToValueAtTime(
        0,
        playTime + clipDuration + endFudge,
      )
      bufNode.start(
        playTime - clipStartFudge,
        clipStart - clipStartFudge,
        clipDuration + clipStartFudge + endFudge,
      )

      if (verbose) console.log(source, playTime, start, end)
    }
  }

  return { duration, run: scheduler }
}
