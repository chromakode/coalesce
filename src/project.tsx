import { dirname, join } from 'path-browserify'
import { Words } from './words'

export interface Track {
  color: string
  audioURL: string
  wordsURL: string
  words: Words
}
export interface Project {
  tracks: { [name: string]: Track }
}

export async function loadProject(
  url = '/project/project.json',
): Promise<Project> {
  const resp = await fetch(url)
  const project: Project = await resp.json()

  const prefix = dirname(url)
  for (const [name, track] of Object.entries(project.tracks)) {
    track.audioURL = join(prefix, `${name}.flac`)
    track.wordsURL = join(prefix, `${name}.json`)

    const resp = await fetch(track.wordsURL)
    const data: Words = await resp.json()
    track.words = data
  }

  return project
}
