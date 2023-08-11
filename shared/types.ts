import { ProjectResult, TrackResult } from './schema.ts'

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

export type TrackInfo = TrackResult

export type ProjectInfo = ProjectResult & {
  tracks: Record<string, TrackInfo>
}

export interface Project extends Omit<ProjectInfo, 'tracks'> {
  tracks: Record<string, Track>
  jobs: Record<string, JobInfo>
}

export interface Track extends TrackInfo {
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

export interface Job {
  id: string
  project: string
  track: string
  task: string
}

export interface AudioJob extends Job {
  task: 'transcribe' | 'chunks'
  inputURI: string
  outputURI: string
  outputFormData: Record<string, string>
}

export interface DocJob extends Job {
  task: 'transcribe_done'
}

export interface JobState extends Job {
  state:
    | { status: 'queued' }
    | { status: 'running'; progress: number }
    | { status: 'complete' }
    | { status: 'failed'; error: string }
}

export type JobInfo = Pick<
  JobState,
  'id' | 'project' | 'track' | 'task' | 'state'
>

export interface SoundLocation {
  key?: string
  source: string
  start: number
  end: number
  children?: SoundLocation[]
}
