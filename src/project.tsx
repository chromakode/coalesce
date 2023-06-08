import { dirname, join } from 'path-browserify'
import slugify from 'slugify'
import { Words } from './words'

export interface Track {
  color: string
  words: Words
  audio: TrackChunks
}

export interface TrackChunks {
  numberOfChannels: number
  sampleRate: number
  sampleCount: number
  chunkLength: number
  chunks: string[]
}

export interface Project {
  title: string
  name: string
  tracks: { [name: string]: Track }
}

export interface ChunksIndex {
  [name: string]: TrackChunks
}

export async function loadProject(
  url = '/project/project.json',
): Promise<Project> {
  const resp = await fetch(url)
  const project: Project = await resp.json()

  const prefix = dirname(url)

  const chunkIndexURL = join(prefix, 'chunks/index.json')
  const chunkIndexResp = await fetch(chunkIndexURL)
  const chunkIndex: ChunksIndex = await chunkIndexResp.json()

  for (const [name, track] of Object.entries(project.tracks)) {
    track.audio = {
      ...chunkIndex[name],
      chunks: chunkIndex[name].chunks.map((src) => join(prefix, src)),
    }

    const wordsURL = join(prefix, `${name}.json`)
    const resp = await fetch(wordsURL)
    const data: Words = await resp.json()
    track.words = data
  }

  project.name = slugify(project.title, {
    remove: /[*+~.()'"!:@$]/g,
  })

  return project
}

export function emptyProject(): Project {
  return { title: 'empty', name: 'empty', tracks: {} }
}
