export interface Word {
  text: string
  start: number
  end: number
  confidence: number
}

export interface Segment {
  id: number
  start: number
  end: number
  text: string
  confidence: number
  words: Word[]
}

export interface Words {
  text: string
  segments: Segment[]
}

export interface Track {
  id: string
  name: string | undefined
  originalFilename: string
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
  id: string
  title: string
  name: string
  tracks: Record<string, Track>
  jobs: Record<string, JobInfo>
}

export type TrackInfo = Pick<Track, 'id' | 'name' | 'originalFilename'>

export type ProjectInfo = Pick<Project, 'id' | 'title' | 'name'> & {
  tracks: TrackInfo[]
}

export type JobInfo = Pick<
  JobState,
  'id' | 'project' | 'track' | 'task' | 'state'
>

export interface ChunksIndex {
  [name: string]: TrackChunks
}

export interface Job {
  id: string
  project: string
  track: string
  task: 'transcribe' | 'chunks'
  inputFile: string
  outputDir: string
}

export interface JobState extends Job {
  state:
    | { status: 'queued' }
    | { status: 'running'; progress: number }
    | { status: 'complete' }
    | { status: 'failed'; error: string }
}
