import { SegmentModel, TrackInfoModel } from '@shared/schema'
import { FetchCreateContextFnOptions, initTRPC, z } from '../deps.ts'
import {
  addWordsToEditor,
  removeTrackFromEditor,
  updateSpeakerInEditor,
} from './editorState.ts'
import { getCollab } from './collab.ts'

export const createContext = (opts: FetchCreateContextFnOptions) => ({
  projectId: opts.req.headers.get('Coalesce-Project')!,
  getCollab: async (projectId: string) => await getCollab(projectId),
})

const t = initTRPC.context<typeof createContext>().create()

export const router = t.router
export const middleware = t.middleware
export const publicProcedure = t.procedure

export const rpcRouter = router({
  addWordsToTrack: publicProcedure
    .input(
      z.object({
        trackInfo: TrackInfoModel,
        segments: z.array(SegmentModel),
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { trackInfo, segments },
        ctx: { projectId, getCollab },
      } = opts

      const collab = await getCollab(projectId)
      await addWordsToEditor({
        editor: collab.getEditor(),
        trackInfo,
        words: segments.flatMap((s) => s.words),
      })
    }),

  handleTranscribeWords: publicProcedure
    .input(
      z.object({
        trackId: z.string(),
        segments: z.array(SegmentModel),
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { trackId, segments },
        ctx: { projectId, getCollab },
      } = opts

      const collab = await getCollab(projectId)
      await collab.getTranscribeBuffer().handleTrackWords({
        trackId,
        segments,
      })
    }),

  handleTranscribeStatus: publicProcedure
    .input(
      z.object({
        trackId: z.string(),
        status: z.union([
          z.literal('running'),
          z.literal('complete'),
          z.literal('failed'),
        ]),
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { trackId, status },
        ctx: { projectId, getCollab },
      } = opts

      const collab = await getCollab(projectId)
      await collab.getTranscribeBuffer().handleTrackStatus({
        trackId,
        status,
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
        ctx: { projectId, getCollab },
      } = opts

      const collab = await getCollab(projectId)
      await removeTrackFromEditor({
        editor: collab.getEditor(),
        trackId,
      })
    }),

  updateSpeaker: publicProcedure
    .input(
      z.object({
        trackInfo: TrackInfoModel,
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { trackInfo },
        ctx: { projectId, getCollab },
      } = opts
      const collab = await getCollab(projectId)
      await updateSpeakerInEditor({
        editor: collab.getEditor(),
        trackInfo,
      })
    }),
})

export type CollabRPCRouter = typeof rpcRouter
