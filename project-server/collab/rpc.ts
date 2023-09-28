import { SegmentModel, TrackColorModel } from '@shared/schema'
import { FetchCreateContextFnOptions, initTRPC, z } from '../deps.ts'
import {
  addWordsToEditor,
  removeTrackFromEditor,
  updateSpeakerInEditor,
} from './editorState.ts'
import { getCollab } from './collab.ts'

export const createContext = (opts: FetchCreateContextFnOptions) => ({
  projectId: opts.req.headers.get('Coalesce-Project')!,
  getEditor: async (projectId: string) =>
    (await getCollab(projectId)).getEditor(),
})

const t = initTRPC.context<typeof createContext>().create()

export const router = t.router
export const middleware = t.middleware
export const publicProcedure = t.procedure

export const rpcRouter = router({
  addWordsToTrack: publicProcedure
    .input(
      z.object({
        trackId: z.string(),
        trackLabel: z.string().optional(),
        trackColor: TrackColorModel.optional(),
        segments: z.array(SegmentModel),
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { trackId, trackLabel, trackColor, segments },
        ctx: { projectId, getEditor },
      } = opts

      const editor = await getEditor(projectId)
      await addWordsToEditor({
        editor,
        trackId,
        trackLabel,
        trackColor,
        segments,
      })
    }),
  removeTrack: publicProcedure
    .input(
      z.object({
        trackId: z.string(),
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { trackId },
        ctx: { projectId, getEditor },
      } = opts

      const editor = await getEditor(projectId)
      await removeTrackFromEditor({
        editor,
        trackId,
      })
    }),
  updateSpeaker: publicProcedure
    .input(
      z.object({
        trackId: z.string(),
        trackLabel: z.string().optional(),
        trackColor: TrackColorModel.optional(),
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { trackId, trackLabel, trackColor },
        ctx: { projectId, getEditor },
      } = opts
      const editor = await getEditor(projectId)
      await updateSpeakerInEditor({
        editor,
        trackId,
        trackLabel,
        trackColor,
      })
    }),
})

export type CollabRPCRouter = typeof rpcRouter
