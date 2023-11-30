import {
  BodyStream,
  createHttpError,
  retry,
  timingSafeEqual,
  streams,
} from '../deps.ts'
import { COALESCE_DEV_FLAGS } from './env.ts'
import { Project } from '@shared/types'
import { ProjectFields, Segment, TrackFields } from '@shared/schema'
import { redisClient, minioClient, minioBucket, collab } from './main.ts'
import { initRedis } from '../lib/service.ts'
import { TRACK_COLOR_ORDER, USER_ROLE } from '@shared/constants'
import { getJobInfo, queueAudioJob, serializeJobInfo } from './worker.ts'
import { storePath } from '../lib/constants.ts'
import {
  generateId,
  generateKey,
  generateShortId,
  fromNodeStream,
  toNodeStream,
} from '../lib/utils.ts'
import { db, getProjectInfo, getTrackInfo } from '../lib/queries.ts'

async function readJSON(path: string): Promise<any> {
  try {
    const resp = await minioClient.getObject(minioBucket, path)
    return await streams.toJson(fromNodeStream(resp))
  } catch (err) {
    if (err.code === 'NoSuchKey') {
      return null
    } else {
      throw err
    }
  }
}

export async function* watchProject(projectId: string) {
  const redisPubSub = await initRedis()

  try {
    // TODO: namespace track update publishes independently from projects,
    // propagate if track in project.
    const sub = await redisPubSub.psubscribe(`project:${projectId}*`)

    // TODO: Manual partial updates to project object. Replace with JSON diff and
    // brute force reload project state on any event?
    const deletedTracks = new Set()
    for await (const { message: rawMsg } of sub.receive()) {
      const msg = JSON.parse(rawMsg)
      if (msg.type === 'job-status') {
        const { job } = msg
        if (deletedTracks.has(job.track)) {
          continue
        }
        yield JSON.stringify({
          type: 'project:update',
          path: `jobs.${job.jobId}.state`,
          data: job.state,
        })
      } else if (msg.type === 'job-created') {
        const { job } = msg
        yield JSON.stringify({
          type: 'project:update',
          path: `jobs.${job.jobId}`,
          data: serializeJobInfo(job),
        })
      } else if (msg.type === 'project-updated') {
        yield JSON.stringify({
          type: 'project:update',
          data: msg.update,
        })
      } else if (msg.type === 'track-updated') {
        yield JSON.stringify({
          type: 'project:update',
          path: `tracks.${msg.trackId}`,
          data: msg.update,
        })
      } else if (msg.type === 'track-removed') {
        deletedTracks.add(msg.id)
        yield JSON.stringify({
          type: 'project:update',
          path: `tracks.${msg.id}`,
          data: null,
        })
      }
    }
  } finally {
    redisPubSub.close()
  }
}

export async function getTrackWords(
  trackId: string,
): Promise<{ segments: Segment[] }> {
  return await readJSON(storePath.trackWords(trackId))
}

export async function getProjectState(projectId: string): Promise<Project> {
  const [info, jobs] = await Promise.all([
    getProjectInfo(projectId),
    getJobInfo(projectId),
  ])

  const state: Project = {
    ...info,
    jobs,
  }

  return state
}

export async function canAccessProject(projectId: string, userId: string) {
  const { count } = await db
    .selectFrom('project')
    .innerJoin('projectUsers', 'projectUsers.projectId', 'project.projectId')
    .where('project.projectId', '=', projectId)
    .where('projectUsers.userId', '=', userId)
    .select(db.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow()
  return count > 0
}

export async function isValidProjectGuestKey(
  projectId: string,
  actualGuestKey: string,
) {
  const { guestEditKey: expectedGuestKey } = await db
    .selectFrom('project')
    .select('guestEditKey')
    .where('project.projectId', '=', projectId)
    .executeTakeFirstOrThrow()

  if (!expectedGuestKey) {
    return false
  }

  const enc = new TextEncoder()
  return timingSafeEqual(
    enc.encode(expectedGuestKey),
    enc.encode(actualGuestKey),
  )
}

export async function projectContainsTrack(projectId: string, trackId: string) {
  const { count } = await db
    .selectFrom('project')
    .innerJoin('projectTracks', 'projectTracks.projectId', 'project.projectId')
    .where('project.projectId', '=', projectId)
    .where('projectTracks.trackId', '=', trackId)
    .select(db.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow()
  return count > 0
}

export async function updateProject(
  projectId: string,
  update: Partial<ProjectFields>,
) {
  if (Object.keys(update).length === 0) {
    return
  }

  if (update.guestEditKey != null && update.guestEditKey !== 'new') {
    throw createHttpError(500, 'Cannot pick guest key')
  }

  if (update.guestEditKey === 'new') {
    update.guestEditKey = generateKey()
  }

  await db
    .updateTable('project')
    .set(update)
    .where('projectId', '=', projectId)
    .executeTakeFirst()

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'project-updated',
      projectId,
      update,
    }),
  )
}

export async function createProject(
  fields: ProjectFields,
  ownerUserId: string,
): Promise<string> {
  const projectId = generateShortId()

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('project')
      .values({ ...fields, projectId })
      .executeTakeFirst()

    await trx
      .insertInto('projectUsers')
      .values({ projectId, userId: ownerUserId, role: USER_ROLE.OWNER })
      .executeTakeFirst()
  })

  return projectId
}

export async function updateTrack(
  projectId: string,
  trackId: string,
  update: Partial<TrackFields>,
) {
  if (Object.keys(update).length === 0) {
    return
  }

  await db
    .updateTable('track')
    .set(update)
    .where('trackId', '=', trackId)
    .executeTakeFirst()

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-updated',
      trackId,
      update,
    }),
  )

  if ('label' in update) {
    const trackInfo = await getTrackInfo(projectId, trackId)
    await collab.rpc(projectId).updateSpeaker.mutate({ trackInfo })
  }
}

export async function createTrack(
  projectId: string,
  fileData: BodyStream,
  originalFilename: string,
): Promise<string> {
  let trackId: string | null = null
  let isReusingTrack

  if (COALESCE_DEV_FLAGS.has('reuse-track-by-filename')) {
    // For development, it's convenient to be able to skip processing delays by
    // uploading the same filename.
    const existingTrack = await db
      .selectFrom('track')
      .where('originalFilename', '=', originalFilename)
      .select(['trackId'])
      .orderBy('createdAt', 'desc')
      .executeTakeFirst()

    if (existingTrack) {
      console.log('DEV: reusing track', trackId, 'for', originalFilename)

      isReusingTrack = true
      trackId = existingTrack.trackId

      for await (const _ of fileData.value) {
        // Noop, finish the upload.
      }
    }
  }

  if (trackId == null) {
    trackId = generateId()

    const uploadPath = storePath.trackUploadPath(trackId)
    await minioClient.putObject(
      minioBucket,
      uploadPath,
      toNodeStream(fileData.value),
    )

    await db
      .insertInto('track')
      .values({ trackId, originalFilename })
      .executeTakeFirst()

    await queueAudioJob({
      task: 'process',
      projectId,
      trackId,
    })
  }

  await retry(
    async () => {
      await db
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (trx) => {
          // Find the next unused color
          const usedColors = await trx
            .selectFrom('projectTracks')
            .where('projectId', '=', projectId)
            .select(['color'])
            .execute()
          const usedColorsSet = new Set(usedColors.map(({ color }) => color))
          const color =
            TRACK_COLOR_ORDER.filter((c) => !usedColorsSet.has(c))[0] ?? 'black'

          await trx
            .insertInto('projectTracks')
            .values({ projectId, trackId: trackId!, color })
            .execute()
        })
    },
    { minTimeout: 50, maxTimeout: 1000 },
  )

  const trackInfo = await getTrackInfo(projectId, trackId)

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-updated',
      trackId,
      update: trackInfo,
    }),
  )

  if (isReusingTrack) {
    // No need to wait for processing to finish
    const { segments } = await getTrackWords(trackId)
    await collab.rpc(projectId).addWordsToTrack.mutate({ trackInfo, segments })

    // Send track state including audio data
    const trackState = await getTrackInfo(projectId, trackId)
    await redisClient.publish(
      `project:${projectId}`,
      JSON.stringify({
        type: 'track-updated',
        trackId,
        update: trackState,
      }),
    )
  }

  return trackId
}

export async function removeTrackFromProject(
  projectId: string,
  trackId: string,
): Promise<void> {
  await db
    .deleteFrom('projectTracks')
    .where('projectId', '=', projectId)
    .where('trackId', '=', trackId)
    .execute()

  const { useCount } = await db
    .selectFrom('projectTracks')
    .where('trackId', '=', trackId)
    .select(db.fn.countAll<number>().as('useCount'))
    .executeTakeFirstOrThrow()

  if (useCount === 0) {
    await db.deleteFrom('track').where('trackId', '=', trackId).execute()

    const trackDir = storePath.trackDir(trackId)
    for await (const entry of fromNodeStream(
      minioClient.listObjects(minioBucket, trackDir),
    )) {
      await minioClient.removeObject(minioBucket, entry.name)
    }
  }

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-removed',
      id: trackId,
    }),
  )

  await collab.rpc(projectId).removeTrack.mutate({ trackId })
}

export async function streamTrackChunk(
  trackId: string,
  chunkName: string,
): Promise<{ stream: ReadableStream; headers: Record<string, string> }> {
  const chunkKey = storePath.trackChunkFile(trackId, chunkName)
  try {
    const resp = await minioClient.getObject(minioBucket, chunkKey)
    // @ts-expect-error minio client types missing response headers
    return { stream: fromNodeStream(resp), headers: resp.headers }
  } catch (err) {
    if (err.code === 'NoSuchKey') {
      throw createHttpError(404)
    } else {
      throw err
    }
  }
}

export async function getSignedTrackChunkURL(
  trackId: string,
  chunkName: string,
  ttl = 300,
): Promise<string> {
  const chunkKey = storePath.trackChunkFile(trackId, chunkName)
  return await minioClient.presignedGetObject(minioBucket, chunkKey, ttl)
}
