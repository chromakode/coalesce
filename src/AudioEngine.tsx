import audioBufferToWav from 'audiobuffer-to-wav'
import { groupBy, last, sortBy } from 'lodash-es'
import { LRUCache } from 'lru-cache'
import mitt from 'mitt'
import { AudioScheduler, AudioTask, SCHEDULER_BUFFER_S } from './AudioScheduler'
import { emptyProject, Project } from './project'

export interface SoundLocation {
  source: string
  start: number
  end: number
}

export interface OffsetSoundLocation extends SoundLocation {
  offset: number
}

export interface SoundLocationWithBuffer extends SoundLocation {
  buffer: AudioBuffer
}

export interface RunningAudioTask {
  audioStartTime: number
  clockStartTime: number
  duration: number
  scheduler: AudioScheduler
  destNode: AudioNode
  stop: () => boolean
}

export type AudioEngineStatus =
  | {
      mode: 'playing'
      startTime: number
      playbackTime: number
      duration: number
    }
  | { mode: 'loading' }
  | { mode: 'stopped' }

export type AudioEngineEvents = {
  status: AudioEngineStatus
}

const MAX_CHUNKS_LOADED = 500
const TICK_MS = 1000

// TODO: consider implementing backend for slicing wavs and lazy load into buffers
export default class AudioEngine {
  ctx: AudioContext = new AudioContext()
  project: Project = emptyProject()
  chunkCache = new LRUCache<string, Promise<AudioBuffer>>({
    max: MAX_CHUNKS_LOADED,
  })
  events = mitt<AudioEngineEvents>()
  status: AudioEngineStatus = { mode: 'stopped' }
  currentTask: RunningAudioTask | null = null

  // TODO: preload on initial load?
  setProject(project: Project) {
    this.project = project
    this.chunkCache.clear()
  }

  async getChunk(src: string): Promise<AudioBuffer> {
    let promise = this.chunkCache.get(src)
    if (!promise) {
      promise = this.fetchChunk(src)
      this.chunkCache.set(src, promise)
    }

    return await promise
  }

  async fetchChunk(src: string): Promise<AudioBuffer> {
    console.log(`downloading ${src}...`)
    const resp = await fetch(src)
    const ab = await resp.arrayBuffer()
    console.log(`decoding ${src}...`)
    const buffer = await this.ctx.decodeAudioData(ab)
    console.log(`finished loading ${src}`)
    return buffer
  }

  // TODO: cache
  async getBufferForLoc(loc: SoundLocation): Promise<SoundLocationWithBuffer> {
    const trackInfo = this.project.tracks[loc.source]
    if (!trackInfo) {
      throw new Error(`Unknown track "${loc.source}"`)
    }
    const { sampleRate, numberOfChannels, chunkLength, sampleCount } =
      trackInfo.audio

    const buffer = new AudioBuffer({
      length: Math.ceil((loc.end - loc.start) * sampleRate),
      numberOfChannels: numberOfChannels,
      sampleRate,
    })

    const startSample = Math.floor(loc.start * sampleRate)
    const startChunk = Math.floor(startSample / chunkLength)
    const endSample = startSample + buffer.length
    const endChunk = Math.floor(endSample / chunkLength)

    let bufferPosition = 0
    for (let chunk = startChunk; chunk <= endChunk; chunk++) {
      const chunkStartSample =
        Math.max(startSample, chunk * chunkLength) % chunkLength
      const chunkEndSample =
        Math.min((chunk + 1) * chunkLength - 1, endSample) % chunkLength

      const chunkBuffer = await this.getChunk(trackInfo.audio.chunks[chunk])

      for (let channel = 0; channel < numberOfChannels; channel++) {
        const samples = chunkBuffer.getChannelData(channel)
        buffer.copyToChannel(
          samples.slice(chunkStartSample, chunkEndSample),
          channel,
          bufferPosition,
        )
      }
      bufferPosition += chunkEndSample - chunkStartSample
    }

    return { ...loc, buffer }
  }

  _emitStatus(status: AudioEngineStatus) {
    this.status = status
    this.events.emit('status', status)
  }

  _launchTask(task: AudioTask, audioStartTime: number): RunningAudioTask {
    const { ctx } = this
    const { duration, run } = task

    const destNode = ctx.createGain()
    destNode.connect(ctx.destination)

    const clockStartTime = Date.now()

    const getBufferForLoc = async (loc: SoundLocation, deadline: number) => {
      const bufferPromise = this.getBufferForLoc(loc)

      const deadlineTimeout = setTimeout(async () => {
        console.warn(
          'Timeout loading buffer for',
          loc,
          '-- restarting playback',
        )
        await bufferPromise
        if (stop()) {
          const restartOffset = deadline - audioStartTime
          this.start(
            { duration: duration - restartOffset, run },
            ctx.currentTime - restartOffset,
          )
        }
      }, Math.max(100, (deadline - ctx.currentTime) * 1000))

      const buffer = await this.getBufferForLoc(loc)
      clearTimeout(deadlineTimeout)

      return buffer
    }

    const scheduler = run(this.ctx, destNode, audioStartTime, getBufferForLoc)
    scheduler.next()

    let tickTimeout: ReturnType<typeof window.setTimeout>

    let stopped = false
    const stop = () => {
      if (stopped) {
        return false
      }
      stopped = true
      scheduler.return()
      clearTimeout(tickTimeout)
      destNode.disconnect()
      return true
    }

    const tick = () => {
      if (stopped) {
        return
      }
      const now = Date.now()

      if (now >= clockStartTime + duration * 1000) {
        stop()
        this._emitStatus({ mode: 'stopped' })
        return
      }

      this._emitStatus({
        mode: 'playing',
        startTime: clockStartTime,
        playbackTime: Math.min(now - clockStartTime, duration * 1000),
        duration,
      })

      scheduler.next(ctx.currentTime)

      const tickMS = Math.max(50, TICK_MS - (now % TICK_MS))
      const endMS = clockStartTime + duration * 1000 - now
      tickTimeout = setTimeout(tick, Math.min(tickMS, endMS))
    }

    this._emitStatus({ mode: 'loading' })

    scheduler.next(ctx.currentTime).then(tick)

    return {
      audioStartTime,
      clockStartTime,
      duration,
      scheduler,
      destNode,
      stop,
    }
  }

  start(task: AudioTask, startTime = this.ctx.currentTime) {
    if (this.currentTask) {
      this.stop()
    }
    this.currentTask = this._launchTask(task, startTime)
  }

  stop() {
    if (this.currentTask) {
      if (this.currentTask.stop()) {
        this._emitStatus({ mode: 'stopped' })
      }
      this.currentTask = null
    }
  }
}

export function padLocation(loc: SoundLocation, before: number, after: number) {
  return {
    ...loc,
    start: Math.max(0, loc.start - before),
    end: loc.end + after,
  }
}

export function offsetMovedLocations(locs: SoundLocation[]) {
  let offset = 0
  let lastLoc = locs[0]
  const newLocs = []

  for (const loc of locs) {
    if (loc.start < lastLoc.start) {
      offset += lastLoc.end - loc.start
    }
    newLocs.push({ ...loc, offset })
    lastLoc = loc
  }

  return newLocs
}

export function coalesceLocations(
  locs: OffsetSoundLocation[],
  threshold = 0.3,
) {
  const newLocs = []
  const bySource = groupBy(locs, (l) => l.source)

  for (const [source, sourceLocs] of Object.entries(bySource)) {
    let start = sourceLocs[0].start
    let end = sourceLocs[0].start
    let offset = sourceLocs[0].offset

    for (const loc of sourceLocs) {
      if (loc.offset === offset && loc.start - end < threshold) {
        end = loc.end
      } else {
        newLocs.push({
          source,
          start,
          end,
          offset,
        })
        start = loc.start
        end = loc.end
        offset = loc.offset
      }
    }

    newLocs.push({
      source,
      start,
      end,
      offset,
    })
  }

  return sortBy(newLocs, (l) => l.start + l.offset)
}

export function removeGaps(locs: OffsetSoundLocation[], padding = 0.15) {
  if (!locs.length) {
    return []
  }

  const baseStart = locs[0].start + locs[0].offset
  let skew = 0
  let end = 0

  const newLocs = []
  for (const loc of locs) {
    const relStart = loc.start + loc.offset - baseStart
    const relEnd = loc.end + loc.offset - baseStart

    if (relStart + skew > end) {
      skew = end - relStart + padding
    }

    if (relEnd + skew > end) {
      end = relEnd + skew
    }

    newLocs.push({
      ...loc,
      offset: loc.offset + skew,
    })
  }

  return newLocs
}

export function processLocations(locs: SoundLocation[]) {
  if (!locs.length) {
    return []
  }

  // 1. If words were moved creating discontinuities, offset later clips so they play afterward
  // 2. Merge adjacent clips into single longer clips
  // 3. Replace gaps with a consistent amount of padding
  return removeGaps(coalesceLocations(offsetMovedLocations(locs)))
}

export function getEndTime(locs: OffsetSoundLocation[]): number | null {
  const lastLoc = last(locs)
  if (!lastLoc) {
    return null
  }
  return lastLoc.end + lastLoc.offset
}

// TODO: make customizable or match input
const CHANNEL_COUNT = 1
const SAMPLE_RATE = 48000

export async function exportWAV(
  engine: AudioEngine,
  task: AudioTask,
  onProgress?: (progress: number) => void,
) {
  const { duration, run } = task

  // Chrome oddly seems to undercalculate the duration of the resulting audio in
  // `OfflineAudioContext.suspend` and will throw if it thinks the output buffer
  // is too short. Add a little time to the end to work around this.
  const CHROME_EXTRA_SAMPLES = 32

  const offlineCtx = new OfflineAudioContext(
    CHANNEL_COUNT,
    Math.ceil(SAMPLE_RATE * duration) + CHROME_EXTRA_SAMPLES,
    SAMPLE_RATE,
  )

  const startTime = 0
  const scheduler = run(
    offlineCtx,
    offlineCtx.destination,
    startTime,
    engine.getBufferForLoc.bind(engine),
  )
  scheduler.next()

  const progressInterval = setInterval(() => {
    const progress = 100 * (offlineCtx.currentTime / duration)
    onProgress?.(progress)
  }, 1000 / 15)

  let buffer: AudioBuffer
  try {
    let bufferPromise: Promise<AudioBuffer> | null = null
    const continueRendering = () => {
      if (bufferPromise === null) {
        bufferPromise = offlineCtx.startRendering()
      } else {
        offlineCtx.resume()
      }
    }

    for (
      let renderTime = 0;
      renderTime <= duration;
      renderTime = Math.min(renderTime + SCHEDULER_BUFFER_S, duration)
    ) {
      const { done } = await scheduler.next(renderTime)

      if (done) {
        continueRendering()
        break
      }

      const finishedChunk = offlineCtx.suspend(renderTime)

      continueRendering()

      await finishedChunk
    }

    buffer = await bufferPromise!
  } finally {
    clearInterval(progressInterval)
  }

  const wav = audioBufferToWav(buffer)
  const blob = new window.Blob([new DataView(wav)], {
    type: 'audio/wav',
  })
  const outputURL = URL.createObjectURL(blob)

  return outputURL
}