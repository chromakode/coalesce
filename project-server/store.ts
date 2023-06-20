import {
  path,
  pick,
  redis,
  slug,
  nanoidCustom,
  ZodTypeAny,
  ZodOutput,
  BodyStream,
} from './deps.ts'
import { REDIS_URL, QUEUE_NAME, PROJECT_DIR } from './env.ts'
import {
  Job,
  ProjectInfo,
  Project,
  Track,
  TrackInfo,
  JobState,
  JobInfo,
} from '@shared/types.ts'
import { redisClient } from './main.ts'
import { ProjectParams, TrackParams } from '../shared/schema.ts'

// For now, a quick'n'dirty flat files data layout!

export const generateId = nanoidCustom(
  '6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz',
  10,
)

async function readJSON(path: string) {
  try {
    return JSON.parse(await Deno.readTextFile(path))
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
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

export const storePath = {
  projectDir: (projectId: string) => path.join(PROJECT_DIR, projectId),
  projectUploadDir: (projectId: string) =>
    path.join(PROJECT_DIR, projectId, 'upload'),
  projectIndex: (projectId: string) =>
    path.join(PROJECT_DIR, projectId, 'index.json'),
  projectTrackDir: (projectId: string) =>
    path.join(PROJECT_DIR, projectId, 'track'),
  trackDir: (projectId: string, trackId: string) =>
    path.join(PROJECT_DIR, projectId, 'track', trackId),
  trackIndex: (projectId: string, trackId: string) =>
    path.join(PROJECT_DIR, projectId, 'track', trackId, 'index.json'),
  trackWords: (projectId: string, trackId: string) =>
    path.join(PROJECT_DIR, projectId, 'track', trackId, 'words.json'),
  trackChunks: (projectId: string, trackId: string) =>
    path.join(PROJECT_DIR, projectId, 'track', trackId, 'chunks.json'),
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

  const trackDir = storePath.projectTrackDir(projectId)
  const tracks: TrackInfo[] = []

  try {
    for await (const { name: trackId } of Deno.readDir(trackDir)) {
      tracks.push(await getTrackInfo(projectId, trackId))
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      // No tracks
    } else {
      throw err
    }
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

export async function listProjects() {
  const projects: ProjectInfo[] = []

  for await (const dirEntry of Deno.readDir(PROJECT_DIR)) {
    const info = await getProjectInfo(dirEntry.name)

    projects.push(info)
  }

  return projects
}

export async function createProject(): Promise<string> {
  const projectId = generateId()
  const projectDir = storePath.projectDir(projectId)
  await Deno.mkdir(projectDir, { recursive: true })
  return projectId
}

export async function updateProject(
  projectId: string,
  params: Partial<ProjectParams>,
) {
  await Deno.writeTextFile(
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
  const trackDir = storePath.trackDir(projectId, trackId)
  await Deno.writeTextFile(
    path.join(trackDir, 'index.json'),
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

export async function createTrack(
  projectId: string,
  fileData: BodyStream,
): Promise<string> {
  const uploadDir = storePath.projectUploadDir(projectId)
  await Deno.mkdir(uploadDir, { recursive: true })

  const trackId = generateId()
  const uploadPath = path.join(uploadDir, trackId)
  const destFile = await Deno.open(uploadPath, {
    create: true,
    write: true,
    truncate: true,
  })

  await fileData.value.pipeTo(destFile.writable)

  const trackDir = storePath.trackDir(projectId, trackId)
  await Deno.mkdir(trackDir, { recursive: true })

  await queueProcessingJob({
    task: 'chunks',
    project: projectId,
    track: trackId,
    inputFile: uploadPath,
    outputDir: trackDir,
  })

  await queueProcessingJob({
    task: 'transcribe',
    project: projectId,
    track: trackId,
    inputFile: uploadPath,
    outputDir: trackDir,
  })

  return trackId
}

export async function deleteTrack(
  projectId: string,
  trackId: string,
): Promise<void> {
  const trackDir = storePath.trackDir(projectId, trackId)
  await Deno.remove(trackDir, { recursive: true })

  await redisClient.publish(
    `project:${projectId}`,
    JSON.stringify({
      type: 'track-deleted',
      id: trackId,
    }),
  )
}
