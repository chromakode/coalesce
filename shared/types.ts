import {
  ProjectResult,
  TrackInfo,
  Job,
  JobStatus,
  TrackAudioMetadata,
} from './schema.ts'

export type { TrackInfo }

export interface SessionInfo {
  userId: string
  email: string
  logoutURL: string
}

export type ProjectInfo = ProjectResult & {
  tracks: Record<string, TrackInfo>
}

export interface Project extends Omit<ProjectInfo, 'tracks'> {
  tracks: Record<string, TrackInfo>
  jobs: Record<string, JobInfo>
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
