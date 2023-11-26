import { Project, SoundLocation } from '@shared/types'
import audioBufferToWav from 'audiobuffer-to-wav'
import { groupBy, last, sortBy } from 'lodash-es'
import { LRUCache } from 'lru-cache'
import mitt from 'mitt'
import { EditorOutputMixer, MixerState, RawOutputMixer } from './AudioMixer'
import { AudioScheduler, AudioTask, SCHEDULER_BUFFER_S } from './AudioScheduler'
import { CoalesceAPIClient, chunkURL } from './api'
import { emptyProject } from './project'

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
  mixer: EditorOutputMixer
  stop: () => boolean
}

export type AudioEngineStatus =
  | { mode: 'uninitialized' }
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
const MAX_BUFFERS_LOADED = 100
const TICK_MS = 1000

// TODO: consider implementing backend for slicing wavs and lazy load into buffers
export default class AudioEngine {
  ctx: AudioContext = new AudioContext()
  api: CoalesceAPIClient
  project: Project = emptyProject()
  mixerSettings: MixerState
  events = mitt<AudioEngineEvents>()
  status: AudioEngineStatus = { mode: 'stopped' }
  currentTask: RunningAudioTask | null = null

  // Cache of loaded audio chunks
  chunkCache = new LRUCache<string, Promise<AudioBuffer>>({
    max: MAX_CHUNKS_LOADED,
  })

  // Cache of location buffers (derived from chunk data)
  locBufferCache = new LRUCache<string, Promise<SoundLocationWithBuffer>>({
    max: MAX_BUFFERS_LOADED,
  })

  constructor(
    api: CoalesceAPIClient,
    project: Project,
    mixerSettings: MixerState,
  ) {
    this.api = api
    this.project = project
    this.mixerSettings = mixerSettings
  }

  updateProject(project: Project) {
    this.project = project
  }

  updateMixerSettings(update: MixerState) {
    this.mixerSettings = update
    if (this.currentTask) {
      this.currentTask.mixer.updateMixerSettings(update)
    }
  }

  getTrackInfo(trackId: string) {
    const trackInfo = this.project.tracks[trackId]
    if (!trackInfo) {
      throw new Error(`Unknown track "${trackId}"`)
    }
    return trackInfo
  }

  getChunkURL(trackId: string, idx: number): string {
    return chunkURL(this.project.projectId, trackId, idx)
  }

  async getChunk(trackId: string, idx: number): Promise<AudioBuffer> {
    const src = this.getChunkURL(trackId, idx)

    let promise = this.chunkCache.get(src)
    if (!promise) {
      promise = this.fetchChunk(src)
      this.chunkCache.set(src, promise)
    }

    return await promise
  }

  async fetchChunk(src: string): Promise<AudioBuffer> {
    console.log(`downloading ${src}...`)
    const resp = await this.api.fetch(src, { credentials: 'include' })
    const ab = await resp.arrayBuffer()
    console.log(`decoding ${src}...`)
    const buffer = await this.ctx.decodeAudioData(ab)
    console.log(`finished loading ${src}`)
    return buffer
  }

  async getBufferForLoc(loc: SoundLocation): Promise<SoundLocationWithBuffer> {
    const key = `${loc.source}-${loc.start}-${loc.end}`

    let promise = this.locBufferCache.get(key)
    if (!promise) {
      promise = this.makeBufferForLoc(loc)
      this.locBufferCache.set(key, promise)
    }

    return await promise
  }

  async makeBufferForLoc(loc: SoundLocation): Promise<SoundLocationWithBuffer> {
    const trackInfo = this.getTrackInfo(loc.source)
    const { sampleRate, numberOfChannels, chunkLength } = trackInfo.audio

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

      const chunkBuffer = await this.getChunk(loc.source, chunk)

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

    // Resume audio context in case it wasn't allowed to start on load
    // https://developer.chrome.com/blog/autoplay/#webaudio
    ctx.resume()

    const mixer = new EditorOutputMixer(
      ctx,
      ctx.destination,
      this.mixerSettings,
    )

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

    const scheduler = run(this.ctx, mixer, audioStartTime, getBufferForLoc)
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
      mixer.destroy()
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
      mixer,
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

  preload(task: AudioTask) {
    const { run } = task

    // Run the scheduler with a null mixer, so it skips playback but fetches buffers
    const scheduler = run(this.ctx, null, 0, this.getBufferForLoc.bind(this))

    scheduler.next()
    scheduler.next(0)
    scheduler.return()
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
): OffsetSoundLocation[] {
  const newLocs = []
  const bySource = groupBy(locs, (l) => l.source)

  for (const [source, sourceLocs] of Object.entries(bySource)) {
    let start = sourceLocs[0].start
    let end = sourceLocs[0].start
    let offset = sourceLocs[0].offset
    let children: OffsetSoundLocation[] = []

    for (const loc of sourceLocs) {
      if (loc.offset === offset && loc.start - end < threshold) {
        end = loc.end
        children.push(loc)
      } else {
        newLocs.push({
          source,
          start,
          end,
          offset,
          children,
        })
        start = loc.start
        end = loc.end
        offset = loc.offset
        children = [loc]
      }
    }

    newLocs.push({
      source,
      start,
      end,
      offset,
      children,
    })
  }

  return sortBy(newLocs, (l) => l.start + l.offset)
}

export function removeGaps(locs: OffsetSoundLocation[], padding = 0.15) {
  if (!locs.length) {
    return []
  }

  const baseStart = 0
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

  const filteredLocs = locs.filter((loc) => {
    if (loc.start === undefined || loc.end === undefined) {
      console.warn('Ignoring location missing timestamps', loc)
      return false
    }
    return true
  })

  // 1. If words were moved creating discontinuities, offset later clips so they play afterward
  // 2. Merge adjacent clips into single longer clips
  // 3. Replace gaps with a consistent amount of padding
  return removeGaps(coalesceLocations(offsetMovedLocations(filteredLocs)))
}

export function decibelsToGain(decibels: number) {
  return Math.pow(10, decibels / 20)
}

export function getEndTime(locs: OffsetSoundLocation[]): number | null {
  // FIXME: This is wrong if a previous loc is longer than the last one
  const lastLoc = last(locs)
  if (!lastLoc) {
    return null
  }
  return lastLoc.end + lastLoc.offset
}

export function getNodeKeyToLoc(locs: OffsetSoundLocation[]) {
  const nodeKeyToLoc: Record<string, OffsetSoundLocation> = {}
  for (const loc of locs) {
    if (loc.key) {
      nodeKeyToLoc[loc.key] = loc
    }
    if (loc.children) {
      for (const childLoc of loc.children) {
        if (childLoc.key) {
          nodeKeyToLoc[childLoc.key] = loc
        }
      }
    }
  }

  return nodeKeyToLoc
}

export function getTimeFromNodeKey(
  nodeKeyToLoc: Record<string, OffsetSoundLocation>,
  key: string,
) {
  const loc = nodeKeyToLoc[key]
  if (!loc) {
    return
  }
  if (loc.children) {
    const child = loc.children.find((c) => c.key === key)
    if (!child) {
      return
    }
    return child.start + loc.offset
  } else {
    return loc.start + loc.offset
  }
}

// TODO: make customizable or match input
const CHANNEL_COUNT = 1
const SAMPLE_RATE = 48000

export async function exportWAV({
  engine,
  mixerState,
  task,
  onProgress,
}: {
  engine: AudioEngine
  mixerState: MixerState | null
  task: AudioTask
  onProgress?: (progress: number) => void
}) {
  const { duration, run } = task

  const offlineCtx = new OfflineAudioContext(
    CHANNEL_COUNT,
    Math.ceil(SAMPLE_RATE * duration),
    SAMPLE_RATE,
  )

  const mixer = mixerState
    ? new EditorOutputMixer(offlineCtx, offlineCtx.destination, mixerState)
    : new RawOutputMixer(offlineCtx, offlineCtx.destination)

  const startTime = 0
  const scheduler = run(
    offlineCtx,
    mixer,
    startTime,
    engine.getBufferForLoc.bind(engine),
  )
  scheduler.next()

  const progressInterval = setInterval(() => {
    const progress = offlineCtx.currentTime / duration
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
      renderTime < duration;
      renderTime = Math.min(renderTime + SCHEDULER_BUFFER_S, duration)
    ) {
      const { done } = await scheduler.next(renderTime)

      if (done) {
        break
      }

      const finishedChunk = offlineCtx.suspend(renderTime)

      continueRendering()

      await finishedChunk
    }

    continueRendering()
    buffer = await bufferPromise!
  } finally {
    clearInterval(progressInterval)
  }

  const wav = audioBufferToWav(buffer)
  const blob = new window.Blob([new DataView(wav)], {
    type: 'audio/wav',
  })

  return blob
}
