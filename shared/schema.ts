import { z } from 'zod'

export const ProjectParams = z.object({
  title: z.string().optional().default('Untitled'),
  hidden: z.boolean().optional().default(false),
})

export type ProjectParams = z.infer<typeof ProjectParams>
export type ProjectParamsInput = z.input<typeof ProjectParams>

export const TrackParams = z.object({
  name: z.string().optional(),
  originalFilename: z.string(),
})

export type TrackParams = z.infer<typeof TrackParams>
export type TrackParamsInput = z.input<typeof TrackParams>
