import audioBufferToWav from 'audiobuffer-to-wav'
import { groupBy, last, sortBy } from 'lodash-es'
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

// TODO: consider implementing backend for slicing wavs and lazy load into buffers
export default class AudioEngine {
  ctx: AudioContext = new AudioContext()
  bufferPromises: Map<string, Promise<AudioBuffer>> = new Map()
  buffers: Map<string, AudioBuffer> = new Map()

  currentlyPlaying: AudioNode | null = null

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

  stop() {
    if (this.currentlyPlaying) {
      this.currentlyPlaying.disconnect()
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

export interface PlayOptions {
  startTime?: number
  startFudge?: number
  endFudge?: number
  verbose?: boolean
  onFinish?: () => void
}

// Outside AudioEngine for hot reloading convenience
export function playLocations(
  engine: AudioEngine,
  ctx: AudioContext | OfflineAudioContext,
  locs: OffsetSoundLocation[],
  {
    startTime = 0,
    startFudge = 0.05,
    endFudge = 0.15,
    verbose = false,
    onFinish,
  }: PlayOptions = {},
) {
  if (!locs.length) {
    return
  }

  if (verbose) console.group('playing')

  const gainNode = ctx.createGain()
  gainNode.connect(ctx.destination)
  engine.currentlyPlaying = gainNode

  const minTime = locs[0].start
  let lastBufNode: AudioBufferSourceNode | null = null

  const { currentTime } = ctx

  for (const { source, start, end, offset } of locs) {
    const buffer = engine.getBuffer(source)

    const wordGainNode = ctx.createGain()
    wordGainNode.connect(gainNode)

    const bufNode = ctx.createBufferSource()
    bufNode.buffer = buffer
    bufNode.connect(wordGainNode)

    let duration = end - start
    let playTime = currentTime - startTime + start + offset - minTime
    if (playTime + duration < 0) {
      continue
    }

    // If clip starts before startTime, truncate.
    if (playTime < 0) {
      playTime = 0
      duration -= playTime
    }

    playTime += startFudge + 0.0001 // Paper over floating precision issues causing negative values

    wordGainNode.gain.setValueAtTime(0, playTime - startFudge)
    wordGainNode.gain.linearRampToValueAtTime(1, playTime)
    wordGainNode.gain.setValueAtTime(1, playTime + duration)
    wordGainNode.gain.linearRampToValueAtTime(0, playTime + duration + endFudge)
    bufNode.start(
      playTime - startFudge,
      start - startFudge,
      duration + startFudge + endFudge,
    )

    if (verbose) console.log(source, playTime, start, end)

    lastBufNode = bufNode
  }

  if (verbose) console.groupEnd()

  lastBufNode!.addEventListener('ended', () => onFinish?.())
}

// TODO: make customizable or match input
const CHANNEL_COUNT = 1
const SAMPLE_RATE = 48000

interface ExportOptions extends PlayOptions {
  onProgress?: (progress: number) => void
}

export async function exportWAV(
  engine: AudioEngine,
  locs: OffsetSoundLocation[],
  { onProgress, ...playOptions }: ExportOptions = {},
) {
  const endTime = getEndTime(locs)
  if (endTime === null) {
    return
  }
  const offlineCtx = new OfflineAudioContext(
    CHANNEL_COUNT,
    Math.floor(SAMPLE_RATE * endTime),
    SAMPLE_RATE,
  )

  playLocations(engine, offlineCtx, locs, playOptions)

  const progressInterval = setInterval(() => {
    const progress = 100 * (offlineCtx.currentTime / endTime)
    onProgress?.(progress)
  }, 1000 / 15)

  let buffer: AudioBuffer
  try {
    buffer = await offlineCtx.startRendering()
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
