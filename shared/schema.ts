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

export const WordModel = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  probability: z.number(),
})
export type Word = z.infer<typeof WordModel>

export const TrackAudioMetadataModel = z.object({
  numberOfChannels: z.number(),
  sampleRate: z.number(),
  sampleCount: z.number(),
  chunkLength: z.number(),
  maxDBFS: z.number(),
})
export type TrackAudioMetadata = z.infer<typeof TrackAudioMetadataModel>

export const SegmentModel = z.object({
  id: z.number(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(WordModel),
})
export type Segment = z.infer<typeof SegmentModel>

export const JobMsgModel = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), data: JobStatusUpdate }),
  z.object({ kind: z.literal('metadata'), data: TrackAudioMetadataModel }),
  z.object({ kind: z.literal('segment'), data: SegmentModel }),
])
export type JobMsg = z.infer<typeof JobMsgModel>

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
  guestEditKey: z.string().nullable().optional(),
})
export type ProjectFields = z.infer<typeof ProjectFields>
export type ProjectFieldsInput = z.input<typeof ProjectFields>

export interface ProjectTable extends ProjectFields {
  projectId: string
  createdAt: ColumnType<Date, undefined, never>
}
export type ProjectResult = Selectable<ProjectTable>

export const TrackFields = z.object({
  label: z.string().optional().nullable(),
})
export type TrackFields = z.infer<typeof TrackFields>
export type TrackFieldsInput = z.input<typeof TrackFields>

export interface TrackTable extends TrackFields {
  trackId: string
  createdAt: ColumnType<string, undefined, never>
  originalFilename: string
}

export const TrackColorModel = z.enum(TRACK_COLOR_ORDER)

export const ProjectTracksFields = z.object({
  color: TrackColorModel.optional(),
})
export type ProjectTracksFields = z.infer<typeof ProjectTracksFields>
export type ProjectTracksFieldsInput = z.input<typeof ProjectTracksFields>

export interface ProjectTracksTable extends ProjectTracksFields {
  projectId: string
  trackId: string
}

export type TrackResult = Selectable<TrackTable> & ProjectTracksFields

// Duplicates the table result type, but distinct as this is the shape we pass around APIs.
export const TrackInfoModel = TrackFields.merge(ProjectTracksFields).merge(
  z.object({
    trackId: z.string(),
    createdAt: z.string(),
    originalFilename: z.string(),
  }),
)
export type TrackInfo = z.infer<typeof TrackInfoModel>

export const ProjectUsersFields = z.object({
  role: z.nativeEnum(USER_ROLE),
})
export type ProjectUsersFields = z.infer<typeof ProjectUsersFields>
export type ProjectUsersFieldsInput = z.input<typeof ProjectUsersFields>
export interface ProjectUsersTable extends ProjectUsersFields {
  projectId: string
  userId: string
}
