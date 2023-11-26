import { SegmentModel, TrackInfoModel } from '@shared/schema'
import { initTRPC, z } from '../deps.ts'
import {
  addWordsToEditor,
  removeTrackFromEditor,
  updateSpeakerInEditor,
} from './editorState.ts'
import { getCollab } from './collab.ts'

export const createContextForProject = (projectId: string) => () => ({
  projectId,
  getCollab: async () => await getCollab(projectId),
})

const t = initTRPC
  .context<ReturnType<typeof createContextForProject>>()
  .create()

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
        ctx: { getCollab },
      } = opts

      const collab = await getCollab()
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
        ctx: { getCollab },
      } = opts

      const collab = await getCollab()
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
        ctx: { getCollab },
      } = opts

      const collab = await getCollab()
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
        ctx: { getCollab },
      } = opts

      const collab = await getCollab()
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
        ctx: { getCollab },
      } = opts
      const collab = await getCollab()
      await updateSpeakerInEditor({
        editor: collab.getEditor(),
        trackInfo,
      })
    }),
})

export type CollabRPCRouter = typeof rpcRouter
