import {
  path,
  pick,
  redis,
  nanoidCustom,
  BodyStream,
  S3Errors,
  createHttpError,
  sql,
} from './deps.ts'
import { REDIS_URL, QUEUE_NAME } from './env.ts'
import {
  Job,
  ProjectInfo,
  Project,
  Track,
  TrackInfo,
  JobState,
  JobInfo,
} from '@shared/types'
import { ProjectFields, TrackFields } from '@shared/schema'
import { db, redisClient, minioClient } from './main.ts'
import { bucket, initMinioJS } from './service.ts'

const nanoidAlphabet = '6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz'
export const generateId = nanoidCustom(nanoidAlphabet, 20)
export const generateShortId = nanoidCustom(nanoidAlphabet, 10)

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
  trackUploadPath: (trackId: string) => path.join(trackId, 'upload'),
  trackDir: (trackId: string) => path.join('track', trackId) + '/',
  trackWords: (trackId: string) => path.join('track', trackId, 'words.json'),
  trackChunks: (trackId: string) => path.join('track', trackId, 'chunks.json'),
  trackChunkFile: (trackId: string, chunkName: string) =>
    path.join('track', trackId, chunkName),
}

export async function queueProcessingJob(jobDesc: Omit<Job, 'id'>) {
  const job: Job = { ...jobDesc, id: generateId() }
  const jobState: JobState = { ...job, state: { status: 'queued' } }

  // Set the initial job state
  await redisClient.set(
    `project:${job.project}.job.${job.id}`,
    JSON.stringify(jobState),
  )

  // Enqueue the job
  await redisClient.lpush(QUEUE_NAME, JSON.stringify(job))

  // Notify that job was created
  await redisClient.publish(
    `project:${job.project}.job`,
    JSON.stringify({
      type: 'job-created',
      job: jobState,
    }),
  )
  return job
}

export async function* watchProject(projectId: string) {
  // Work around https://github.com/denodrivers/redis/issues/390
  const redisPubSub = await redis.connect(redis.parseURL(REDIS_URL))

  const sub = await redisPubSub.psubscribe(`project:${projectId}*`)

  const deletedTracks = new Set()

  // TODO: Manual partial updates to project object. Replace with JSON diff and
  // brute force reload project state on any event?
  for await (const recv of sub.receive()) {
    const msg = JSON.parse(recv.message)
    if (msg.type === 'job-status') {
      if (deletedTracks.has(msg.track)) {
        continue
      }
      yield JSON.stringify({
        type: 'project:update',
        path: `jobs.${msg.id}.state`,
        data: msg.state,
      })
      if (msg.state.status === 'complete') {
        yield JSON.stringify({
          type: 'project:update',
          path: `tracks.${msg.track}`,
          data: await getTrackState(msg.track),
        })
      }
    } else if (msg.type === 'job-created') {
      yield JSON.stringify({
        type: 'project:update',
        path: `jobs.${msg.job.id}`,
        data: serializeJobInfo(msg.job),
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
    } else if (msg.type === 'track-deleted') {
      deletedTracks.add(msg.id)
      yield JSON.stringify({
        type: 'project:update',
        path: `tracks.${msg.id}`,
        data: null,
      })
    }
  }
}

function serializeJobInfo(jobData: JobState): JobInfo {
  return pick(jobData, ['id', 'project', 'track', 'task', 'state'])
}

async function getJobInfo(projectId: string): Promise<Record<string, JobInfo>> {
  const jobs: Record<string, JobInfo> = {}

  let nextCursor = 0
  do {
    // FIXME: https://github.com/denodrivers/redis/issues/391
    const [cursor, keys] = await redisClient.scan(nextCursor, {
      pattern: `project:${projectId}.job.*`,
    })
    nextCursor = Number(cursor)

    if (!keys.length) {
      continue
    }

    const values = await redisClient.mget(...keys)
    for (const jobDataText of values) {
      if (jobDataText == null) {
        continue
      }

      const jobData: JobState = JSON.parse(jobDataText)
      jobs[jobData.id] = serializeJobInfo(jobData)
    }
  } while (nextCursor != 0)

  return jobs
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

export async function getTrackState(trackId: string): Promise<Track> {
  const trackInfo = await getTrackInfo(trackId)
  const words = await readJSON(storePath.trackWords(trackId))
  const audio = await readJSON(storePath.trackChunks(trackId))
  return { ...trackInfo, words, audio }
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
}

async function makeUploadURL(prefix: string) {
  // Deno-S3-Lite doesn't support post policies, so using MinioJS for this
  const minioJS = initMinioJS()
  const policy = minioJS.newPostPolicy()

  policy.setKeyStartsWith(prefix)
  policy.setBucket(bucket)

  const expires = new Date()
  expires.setSeconds(24 * 60 * 60) // 1 day
  policy.setExpires(expires)

  return await minioJS.presignedPostPolicy(policy)
}

export async function createTrack(
  projectId: string,
  fileData: BodyStream,
  originalFilename: string,
): Promise<string> {
  const trackId = generateId()
  const uploadPath = storePath.trackUploadPath(trackId)
  await minioClient.putObject(uploadPath, fileData.value, {
    partSize: 16 * 1024 * 1024,
  })

  await db
    .insertInto('track')
    .values({ trackId, originalFilename })
    .executeTakeFirst()

  await db
    .insertInto('projectTracks')
    .values({ projectId, trackId })
    .executeTakeFirst()

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-updated',
      trackId,
      update: { originalFilename },
    }),
  )

  const inputURI = await minioClient.getPresignedUrl('GET', uploadPath)

  const trackDir = storePath.trackDir(trackId)
  const { postURL: outputURI, formData: outputFormData } = await makeUploadURL(
    trackDir,
  )
  outputFormData['key'] = path.join(trackDir, '${filename}')

  await queueProcessingJob({
    task: 'chunks',
    project: projectId,
    track: trackId,
    inputURI,
    outputURI,
    outputFormData,
  })

  await queueProcessingJob({
    task: 'transcribe',
    project: projectId,
    track: trackId,
    inputURI,
    outputURI,
    outputFormData,
  })

  return trackId
}

export async function deleteTrack(
  projectId: string,
  trackId: string,
): Promise<void> {
  const trackDir = storePath.trackDir(trackId)
  for await (const entry of minioClient.listObjects({ prefix: trackDir })) {
    await minioClient.deleteObject(entry.key)
  }

  await db.deleteFrom('track').where('trackId', '=', trackId).execute()
  await db
    .deleteFrom('projectTracks')
    .where('projectId', '=', projectId)
    .where('trackId', '=', trackId)
    .execute()

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-deleted',
      id: trackId,
    }),
  )
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
