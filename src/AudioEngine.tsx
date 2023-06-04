import audioBufferToWav from 'audiobuffer-to-wav'
import { groupBy, last, sortBy } from 'lodash-es'
import mitt from 'mitt'
import { AudioScheduler, AudioTask } from './AudioScheduler'
import { Project } from './project'

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
  stop: () => void
}

export type AudioEngineStatus =
  | {
      status: 'playing'
      startTime: number
      playbackTime: number
      duration: number
    }
  | { status: 'stopped' }

export type AudioEngineEvents = {
  status: AudioEngineStatus
}

const TICK_MS = 1000
const SCHEDULER_BUFFER_S = 2

// TODO: consider implementing backend for slicing wavs and lazy load into buffers
export default class AudioEngine {
  ctx: AudioContext = new AudioContext()
  bufferPromises: Map<string, Promise<AudioBuffer>> = new Map()
  buffers: Map<string, AudioBuffer> = new Map()
  events = mitt<AudioEngineEvents>()
  status: AudioEngineStatus = { status: 'stopped' }
  currentTask: RunningAudioTask | null = null

  loadProject(project: Project): Promise<AudioBuffer[]> {
    return Promise.all(
      Object.entries(project.tracks).map(([name, { audioURL }]) =>
        this.loadBuffer(name, audioURL),
      ),
    )
  }

  async loadBuffer(key: string, src: string): Promise<AudioBuffer> {
    let bufferPromise = this.bufferPromises.get(key)
    if (bufferPromise) {
      return bufferPromise
    }

    bufferPromise = this._fetchBuffer(src)
    this.bufferPromises.set(key, bufferPromise)
    const buffer = await bufferPromise
    this.buffers.set(key, buffer)
    return buffer
  }

  async _fetchBuffer(src: string): Promise<AudioBuffer> {
    const resp = await fetch(src)
    const ab = await resp.arrayBuffer()
    console.log(`decoding ${src}...`)
    const buffer = await this.ctx.decodeAudioData(ab)
    console.log(`finished loading ${src}`)
    return buffer
  }

  getBuffer(key: string) {
    const buffer = this.buffers.get(key)
    if (!buffer) {
      throw new Error(`buffer ${key} not loaded`)
    }
    return buffer
  }

  getBufferForLoc(loc: SoundLocation): SoundLocationWithBuffer {
    const sourceBuffer = this.getBuffer(loc.source)
    const { sampleRate, numberOfChannels } = sourceBuffer

    const buffer = new AudioBuffer({
      length: Math.ceil((loc.end - loc.start) * sampleRate),
      numberOfChannels: numberOfChannels,
      sampleRate,
    })

    for (let channel = 0; channel < numberOfChannels; channel++) {
      const samples = sourceBuffer.getChannelData(channel)
      buffer.copyToChannel(
        samples.slice(
          Math.floor(loc.start * sampleRate),
          Math.floor(loc.end * sampleRate),
        ),
        channel,
      )
    }
    return { ...loc, buffer }
  }

  _emitStatus(status: AudioEngineStatus) {
    this.status = status
    this.events.emit('status', status)
  }

  _launchTask(task: AudioTask): RunningAudioTask {
    const { ctx } = this

    const { duration, run } = task

    const destNode = ctx.createGain()
    destNode.connect(ctx.destination)

    const audioStartTime = ctx.currentTime
    const clockStartTime = Date.now()

    const scheduler = run(this, this.ctx, destNode, audioStartTime)
    scheduler.next(0)

    let timeout: ReturnType<typeof window.setTimeout>

    const tick = () => {
      const now = Date.now()

      if (now >= clockStartTime + duration * 1000) {
        this.stop()
        return
      }

      scheduler.next(ctx.currentTime + SCHEDULER_BUFFER_S)

      this._emitStatus({
        status: 'playing',
        startTime: clockStartTime,
        playbackTime: Math.min(now - clockStartTime, duration * 1000),
        duration,
      })

      const tickMS = Math.max(50, TICK_MS - (now % TICK_MS))
      const endMS = clockStartTime + duration * 1000 - now
      timeout = setTimeout(tick, Math.min(tickMS, endMS))
    }

    const stop = () => {
      scheduler.return()
      clearTimeout(timeout)
      destNode.disconnect()
      this._emitStatus({ status: 'stopped' })
    }

    tick()

    return {
      audioStartTime,
      clockStartTime,
      duration,
      scheduler,
      destNode,
      stop,
    }
  }

  start(task: AudioTask) {
    if (this.currentTask) {
      this.stop()
    }
    this.currentTask = this._launchTask(task)
  }

  stop() {
    if (this.currentTask) {
      this.currentTask.stop()
      this.currentTask = null
    }
  }
}

export function padLocation(loc: SoundLocation, padding: number) {
  return {
    ...loc,
    start: Math.max(0, loc.start - padding),
    end: loc.end + padding,
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
  const scheduler = run(engine, offlineCtx, offlineCtx.destination, startTime)
  scheduler.next(0)

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
      let renderTime = SCHEDULER_BUFFER_S;
      renderTime <= duration;
      renderTime = Math.min(renderTime + SCHEDULER_BUFFER_S, duration)
    ) {
      const { done } = scheduler.next(renderTime)

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
