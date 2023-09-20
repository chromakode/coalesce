import { z } from 'zod'
import type { ColumnType, Selectable } from 'kysely'
import { TRACK_COLOR_ORDER, USER_ROLE } from './constants.ts'

export const JobModel = z.object({
  jobId: z.string(),
  projectId: z.string(),
  trackId: z.string(),
  task: z.string(),
})
export type Job = z.infer<typeof JobModel>

export const JobStatusUpdate = z.discriminatedUnion('status', [
  z.object({ status: z.literal('queued') }),
  z.object({ status: z.literal('running'), progress: z.number() }),
  z.object({ status: z.literal('complete') }),
  z.object({ status: z.literal('failed'), error: z.string() }),
])
export type JobStatus = z.infer<typeof JobStatusUpdate>

export const AudioJobModel = JobModel.extend({
  task: z.literal('process'),
})
export type AudioJob = z.infer<typeof AudioJobModel>

export const ProcessAudioRequestModel = z.object({
  jobId: z.string(),
  jobKey: z.string(),
  statusURI: z.string(),
  inputURI: z.string(),
  outputURIBase: z.string(),
})
export type ProcessAudioRequest = z.infer<typeof ProcessAudioRequestModel>

export const ProjectFields = z.object({
  title: z.string().optional().default('Untitled'),
  hidden: z.boolean().optional().default(false),
})
export type ProjectFields = z.infer<typeof ProjectFields>
export type ProjectFieldsInput = z.input<typeof ProjectFields>

export interface ProjectTable extends ProjectFields {
  projectId: string
  createdAt: ColumnType<Date, undefined, never>
}
export type ProjectResult = Selectable<ProjectTable>

export const TrackFields = z.object({
  label: z.string().optional(),
})
export type TrackFields = z.infer<typeof TrackFields>
export type TrackFieldsInput = z.input<typeof TrackFields>

export interface TrackTable extends TrackFields {
  trackId: string
  createdAt: ColumnType<Date, undefined, never>
  originalFilename: string
}

export const ProjectTracksFields = z.object({
  color: z.enum(TRACK_COLOR_ORDER).optional(),
})
export type ProjectTracksFields = z.infer<typeof ProjectTracksFields>
export type ProjectTracksFieldsInput = z.input<typeof ProjectTracksFields>

export interface ProjectTracksTable extends ProjectTracksFields {
  projectId: string
  trackId: string
}

export type TrackResult = Selectable<TrackTable> & ProjectTracksFields

export const ProjectUsersFields = z.object({
  role: z.nativeEnum(USER_ROLE),
})
export type ProjectUsersFields = z.infer<typeof ProjectUsersFields>
export type ProjectUsersFieldsInput = z.input<typeof ProjectUsersFields>
export interface ProjectUsersTable extends ProjectUsersFields {
  projectId: string
  userId: string
}
