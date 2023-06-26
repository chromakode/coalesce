import {
  path,
  pick,
  redis,
  slug,
  nanoidCustom,
  ZodTypeAny,
  ZodOutput,
  BodyStream,
  S3Errors,
  createHttpError,
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
} from '@shared/types.ts'
import { redisClient, minioClient } from './main.ts'
import { ProjectParams, TrackParams } from '../shared/schema.ts'
import { bucket, initMinioJS } from './service.ts'

export const generateId = nanoidCustom(
  '6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz',
  10,
)

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

async function readJSONSchema<T extends ZodTypeAny>(
  path: string,
  schema: T,
): Promise<ZodOutput<T>> {
  const data = await readJSON(path)
  return schema.parse(data ?? {})
}

async function* listDir(path: string) {
  for await (const entry of minioClient.listObjectsGrouped({
    prefix: path,
    delimiter: '/',
  })) {
    if (entry.type === 'CommonPrefix') {
      yield entry.prefix.substring(path.length).split('/')[0]
    }
  }
}

export const storePath = {
  projectIndex: (projectId: string) => path.join(projectId, 'index.json'),
  projectTracksDir: (projectId: string) => path.join(projectId, 'track') + '/',
  trackDir: (projectId: string, trackId: string) =>
    path.join(projectId, 'track', trackId) + '/',
  trackUploadPath: (projectId: string, trackId: string) =>
    path.join(projectId, 'upload', trackId),
  trackIndex: (projectId: string, trackId: string) =>
    path.join(projectId, 'track', trackId, 'index.json'),
  trackWords: (projectId: string, trackId: string) =>
    path.join(projectId, 'track', trackId, 'words.json'),
  trackChunks: (projectId: string, trackId: string) =>
    path.join(projectId, 'track', trackId, 'chunks.json'),
  trackChunkFile: (projectId: string, trackId: string, chunkName: string) =>
    path.join(projectId, 'track', trackId, chunkName),
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
          data: await getTrackState(projectId, msg.track),
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
        path: `tracks.${msg.id}`,
        data: { id: msg.id, ...msg.update },
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

export async function getTrackInfo(
  projectId: string,
  trackId: string,
): Promise<TrackInfo> {
  const { name, originalFilename } = await readJSONSchema(
    storePath.trackIndex(projectId, trackId),
    TrackParams,
  )
  return { id: trackId, name, originalFilename }
}

export async function getProjectInfo(projectId: string): Promise<ProjectInfo> {
  const { title } = await readJSONSchema(
    storePath.projectIndex(projectId),
    ProjectParams,
  )

  const tracksDir = storePath.projectTracksDir(projectId)
  const tracks: TrackInfo[] = []
  for await (const trackId of listDir(tracksDir)) {
    tracks.push(await getTrackInfo(projectId, trackId))
  }

  return {
    id: projectId,
    name: slug(title, {
      remove: /[*+~.()'"!:@$]/g,
    }),
    title,
    tracks,
  }
}

export async function getTrackState(
  projectId: string,
  trackId: string,
): Promise<Track> {
  const trackInfo = await getTrackInfo(projectId, trackId)
  const words = await readJSON(storePath.trackWords(projectId, trackId))
  const audio = await readJSON(storePath.trackChunks(projectId, trackId))
  return { ...trackInfo, words, audio }
}

export async function getProjectState(projectId: string): Promise<Project> {
  const [info, jobs] = await Promise.all([
    getProjectInfo(projectId),
    getJobInfo(projectId),
  ])

  const tracks: Record<string, Track> = {}
  for (const { id } of info.tracks) {
    // FIXME: re-reads the track index an extra time
    tracks[id] = await getTrackState(projectId, id)
  }

  const state: Project = {
    ...info,
    tracks,
    jobs,
  }

  return state
}

export async function projectExists(projectId: string) {
  return await minioClient.exists(storePath.projectIndex(projectId))
}

export async function listProjects() {
  const projects: ProjectInfo[] = []

  for await (const name of listDir('')) {
    const info = await getProjectInfo(name)

    projects.push(info)
  }

  return projects
}

export async function updateProject(
  projectId: string,
  params: Partial<ProjectParams>,
) {
  await minioClient.putObject(
    storePath.projectIndex(projectId),
    JSON.stringify(params),
  )

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'project-updated',
      id: projectId,
      update: params,
    }),
  )
}

export async function updateTrack(
  projectId: string,
  trackId: string,
  params: Partial<TrackParams>,
) {
  await minioClient.putObject(
    storePath.trackIndex(projectId, trackId),
    JSON.stringify(params),
  )

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-updated',
      id: trackId,
      update: params,
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
): Promise<string> {
  const trackId = generateId()
  const uploadPath = storePath.trackUploadPath(projectId, trackId)
  await minioClient.putObject(uploadPath, fileData.value, {
    partSize: 16 * 1024 * 1024,
  })

  const inputURI = await minioClient.getPresignedUrl('GET', uploadPath)

  const trackDir = storePath.trackDir(projectId, trackId)
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
  const trackDir = storePath.trackDir(projectId, trackId)
  for await (const entry of minioClient.listObjects({ prefix: trackDir })) {
    await minioClient.deleteObject(entry.key)
  }

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-deleted',
      id: trackId,
    }),
  )
}

export async function streamTrackChunk(
  projectId: string,
  trackId: string,
  chunkName: string,
): Promise<ReadableStream> {
  const chunkKey = storePath.trackChunkFile(projectId, trackId, chunkName)
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
