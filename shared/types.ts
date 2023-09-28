import {
  ProjectResult,
  TrackResult,
  Job,
  JobStatus,
  Segment,
  TrackAudioMetadata,
} from './schema.ts'

export interface SessionInfo {
  userId: string
  email: string
  logoutURL: string
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
  audio: TrackAudioMetadata
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
