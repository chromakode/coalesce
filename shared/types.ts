import { ProjectResult, TrackResult, Job, JobStatus } from './schema.ts'

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

export interface JobState extends Job {
  state: JobStatus
}

export type JobInfo = Pick<
  JobState,
  'jobId' | 'projectId' | 'trackId' | 'task' | 'state'
>

export interface SoundLocation {
  key?: string
  source: string
  start: number
  end: number
  children?: SoundLocation[]
}
