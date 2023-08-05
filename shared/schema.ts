import { z } from 'zod'
import type { ColumnType, Selectable } from 'kysely'

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
export type ProjectResult = Omit<Selectable<ProjectTable>, 'sid'>

export const TrackFields = z.object({
  label: z.string().optional(),
  originalFilename: z.string(),
})
export type TrackFields = z.infer<typeof TrackFields>
export type TrackFieldsInput = z.input<typeof TrackFields>

export interface TrackTable extends TrackFields {
  trackId: string
  createdAt: ColumnType<Date, undefined, never>
}
export type TrackResult = Omit<Selectable<TrackTable>, 'sid'>
