import { z } from 'zod'
import type { ColumnType, Selectable } from 'kysely'
import { TRACK_COLOR_ORDER } from '@shared/constants'

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
