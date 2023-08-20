import { Buffer as NodeBuffer } from 'node:buffer'
import {
  path,
  nanoidCustom,
  BodyStream,
  S3Errors,
  createHttpError,
  sql,
  awarenessProtocol,
  Y,
} from '../deps.ts'
import { COALESCE_DEV_FLAGS } from '../env.ts'
import { ProjectInfo, Project, Track, TrackInfo } from '@shared/types'
import { ProjectFields, TrackFields } from '@shared/schema'
import { db, redisClient, minioClient } from '../main.ts'
import { initRedis } from '../service.ts'
import {
  addTrackToYDoc,
  projectToYDoc,
  removeTrackFromYDoc,
  updateSpeakerInYDoc,
} from '../editorState.ts'
import { sendDocUpdate } from '../socket.ts'
import { TRACK_COLOR_ORDER } from '@shared/constants'
import { retry } from 'https://deno.land/std@0.191.0/async/retry.ts'
import { getJobInfo, queueAudioJob, serializeJobInfo } from './worker.ts'

const nanoidAlphabet = '6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz'
export const generateId = nanoidCustom(nanoidAlphabet, 20)
export const generateShortId = nanoidCustom(nanoidAlphabet, 10)
export const generateJobKey = nanoidCustom(nanoidAlphabet, 30)

async function readJSON(path: string) {
  try {
    const resp = await minioClient.getObject(path)
    return await resp.json()
  } catch (err) {
    if (err instanceof S3Errors.ServerError && err.code === 'NoSuchKey') {
      return null
    } else {
      throw err
    }
  }
}

export const storePath = {
  projectDocPath: (projectId: string, versionId: string) =>
    path.join('project', projectId, 'doc', versionId),
  trackUploadPath: (trackId: string) => path.join('track', trackId, 'upload'),
  trackDir: (trackId: string) => path.join('track', trackId) + '/',
  trackWords: (trackId: string) => path.join('track', trackId, 'words.json'),
  trackChunks: (trackId: string) => path.join('track', trackId, 'chunks.json'),
  trackChunkFile: (trackId: string, chunkName: string) =>
    path.join('track', trackId, chunkName),
}

export async function* watchProject(projectId: string) {
  const redisPubSub = await initRedis()

  try {
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
        if (job.state.status === 'complete') {
          yield JSON.stringify({
            type: 'project:update',
            path: `tracks.${job.trackId}`,
            data: await getTrackState(job.projectId, job.trackId),
          })
        }
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
          data: { trackId: msg.trackId, ...msg.update },
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

export async function getAwarenessData(
  projectId: string,
): Promise<Uint8Array | null> {
  return (await redisClient.sendCommand(
    'GET',
    [`project:${projectId}.awareness`],
    { returnUint8Arrays: true },
  )) as Uint8Array
}

export async function saveAwarenessData(projectId: string, data: Uint8Array) {
  await redisClient.setex(
    `project:${projectId}.awareness`,
    awarenessProtocol.outdatedTimeout,
    NodeBuffer.from(data),
  )
}

export async function coalesceCollabDoc(
  projectId: string,
): Promise<Uint8Array | null> {
  // Merging fetcher to allow lock-free persistince.
  //
  // Minio guarantees strict list-after-write behavior:
  // https://github.com/minio/minio/blob/master/docs/distributed/README.md#consistency-guarantees
  //
  // To get the latest version of the doc:
  // 1. Fetch all versions in the bucket and merge together
  // 2. Write new merged version
  // 3. Delete seen old versions
  const seenKeys = []
  const versions = []

  for await (const entry of minioClient.listObjects({
    prefix: storePath.projectDocPath(projectId, ''),
  })) {
    try {
      const resp = await minioClient.getObject(entry.key)
      const ab = await resp.arrayBuffer()
      versions.push(new Uint8Array(ab))
      seenKeys.push(entry.key)
    } catch (err) {
      console.warn('Error fetching collab doc version', entry.key, err)
      continue
    }
  }

  if (versions.length === 0) {
    return null
  } else if (versions.length === 1) {
    // If only one version exists, no need to merge.
    return versions[0]
  }

  const mergeDoc = new Y.Doc({ gc: true })
  for (const version of versions) {
    Y.applyUpdate(mergeDoc, version)
  }

  const mergeData = Y.encodeStateAsUpdate(mergeDoc)

  await minioClient.putObject(
    storePath.projectDocPath(projectId, generateId()),
    mergeData,
  )

  for (const seenKey of seenKeys) {
    try {
      await minioClient.deleteObject(seenKey)
    } catch (err) {
      console.warn('Error deleting collab doc version', seenKey, err)
      continue
    }
  }

  return mergeData
}

export async function generateCollabDoc(
  projectId: string,
  baseDoc: Uint8Array | null = null,
): Promise<Uint8Array> {
  const project = await getProjectState(projectId)
  const doc = await projectToYDoc(project, baseDoc)
  return Y.encodeStateAsUpdate(doc)
}

export async function saveCollabDoc(projectId: string, data: Uint8Array) {
  // Store the doc w/ a random version id
  await minioClient.putObject(
    storePath.projectDocPath(projectId, generateId()),
    data,
  )

  // Merge existing versions together
  coalesceCollabDoc(projectId)
}

export async function* watchProjectCollab(
  projectId: string,
  awarenessId: number,
) {
  const redisPubSub = await initRedis()
  const ownChannel = `project-collab:${projectId}@${awarenessId}`

  try {
    const sub = await redisPubSub.psubscribe(`project-collab:${projectId}*`)

    for await (const { channel, message } of sub.receiveBuffers()) {
      if (channel === ownChannel) {
        continue
      }
      yield message
    }
  } finally {
    redisPubSub.close()
  }
}

export async function publishProjectCollab(
  projectId: string,
  awarenessId: number | string,
  data: ArrayBuffer,
) {
  await redisClient.publish(
    `project-collab:${projectId}@${awarenessId}`,
    NodeBuffer.from(data),
  )
}

async function _updateCollabDoc(
  projectId: string,
  updater: (project: Project, baseDoc: Uint8Array | null) => Promise<Y.Doc>,
) {
  const project = await getProjectState(projectId)
  const baseDoc = await coalesceCollabDoc(projectId)
  const doc = await updater(project, baseDoc)
  await saveCollabDoc(projectId, Y.encodeStateAsUpdate(doc))
  await sendDocUpdate(
    projectId,
    Y.encodeStateAsUpdate(doc, baseDoc ?? undefined),
  )
}

export async function addTrackToCollabDoc(projectId: string, trackId: string) {
  await _updateCollabDoc(projectId, (project, baseDoc) =>
    addTrackToYDoc(project, trackId, baseDoc),
  )
}

export async function removeTrackFromCollabDoc(
  projectId: string,
  trackId: string,
) {
  await _updateCollabDoc(projectId, (project, baseDoc) =>
    removeTrackFromYDoc(project, trackId, baseDoc),
  )
}

export async function updateSpeakerInCollabDoc(
  projectId: string,
  trackId: string,
) {
  await _updateCollabDoc(projectId, (project, baseDoc) =>
    updateSpeakerInYDoc(project, trackId, baseDoc),
  )
}

export async function getTrackInfo(trackId: string): Promise<TrackInfo> {
  return await db
    .selectFrom('track')
    .where('trackId', '=', trackId)
    .select(['trackId', 'createdAt', 'label', 'originalFilename'])
    .executeTakeFirstOrThrow()
}

function projectQuery() {
  return db.selectFrom('project').select(({ selectFrom }) => [
    'projectId',
    'createdAt',
    'title',
    'hidden',
    sql<Record<string, TrackInfo>>`(select coalesce(json_object_agg(
      ${sql.id('info', 'trackId')}, row_to_json(info)
    ), '{}') from ${selectFrom('track')
      .innerJoin('projectTracks', (join) =>
        join
          .onRef('track.trackId', '=', 'projectTracks.trackId')
          .onRef('project.projectId', '=', 'projectTracks.projectId'),
      )
      .select([
        'track.trackId',
        'track.createdAt',
        'track.label',
        'track.originalFilename',
        'projectTracks.color',
      ])
      .as('info')})`.as('tracks'),
  ])
}

export async function getProjectInfo(projectId: string): Promise<ProjectInfo> {
  return await projectQuery()
    .where('projectId', '=', projectId)
    .executeTakeFirstOrThrow()
}

export async function listProjects(): Promise<ProjectInfo[]> {
  return await projectQuery().execute()
}

export async function getTrackState(
  projectId: string,
  trackId: string,
): Promise<Track> {
  const trackInfo = await getTrackInfo(trackId)
  const { color } = await db
    .selectFrom('projectTracks')
    .where('projectId', '=', projectId)
    .where('trackId', '=', trackId)
    .select(['color'])
    .executeTakeFirstOrThrow()
  const words = await readJSON(storePath.trackWords(trackId))
  const audio = await readJSON(storePath.trackChunks(trackId))
  return { ...trackInfo, color, words, audio }
}

export async function getProjectState(projectId: string): Promise<Project> {
  const [info, jobs] = await Promise.all([
    getProjectInfo(projectId),
    getJobInfo(projectId),
  ])

  const tracks: Record<string, Track> = {}
  for (const [trackId, trackInfo] of Object.entries(info.tracks)) {
    const words = await readJSON(storePath.trackWords(trackId))
    const audio = await readJSON(storePath.trackChunks(trackId))
    tracks[trackId] = { ...trackInfo, words, audio }
  }

  const state: Project = {
    ...info,
    tracks,
    jobs,
  }

  return state
}

export async function projectExists(projectId: string) {
  const { count } = await db
    .selectFrom('project')
    .where('projectId', '=', projectId)
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

export async function createProject(fields: ProjectFields): Promise<string> {
  const projectId = generateShortId()

  await db
    .insertInto('project')
    .values({ ...fields, projectId })
    .executeTakeFirst()

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

  await updateSpeakerInCollabDoc(projectId, trackId)
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
    await minioClient.putObject(uploadPath, fileData.value, {
      partSize: 16 * 1024 * 1024,
    })

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

  const trackState = await getTrackState(projectId, trackId)

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-updated',
      trackId,
      update: trackState,
    }),
  )

  if (isReusingTrack) {
    // No need to wait for processing to finish
    await addTrackToCollabDoc(projectId, trackId)
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
    for await (const entry of minioClient.listObjects({ prefix: trackDir })) {
      await minioClient.deleteObject(entry.key)
    }
  }

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-removed',
      id: trackId,
    }),
  )

  await removeTrackFromCollabDoc(projectId, trackId)
}

export async function streamTrackChunk(
  trackId: string,
  chunkName: string,
): Promise<ReadableStream> {
  const chunkKey = storePath.trackChunkFile(trackId, chunkName)
  try {
    const resp = await minioClient.getObject(chunkKey)
    if (resp.body == null) {
      throw createHttpError(500)
    }
    return resp.body
  } catch (err) {
    if (err instanceof S3Errors.ServerError && err.code === 'NoSuchKey') {
      throw createHttpError(404)
    } else {
      throw err
    }
  }
}
