import { AudioJob, Job, JobStatus } from '@shared/schema'
import { JobInfo, JobState } from '@shared/types'
import { AUDIO_QUEUE_NAME } from '../env.ts'
import { generateId, generateJobKey } from '../store/index.ts'
import { ZodOutput, ZodTypeAny, pick } from '../deps.ts'
import { initRedis } from '../service.ts'
import { redisClient } from '../main.ts'

export const JOB_STATE_TTL = 60 * 60
export const JOB_KEY_TTL = JOB_STATE_TTL

export async function* consumeJobs<ModelType extends ZodTypeAny>(
  queueName: string,
  processingQueueName: string,
  jobModel: ModelType,
): AsyncGenerator<{ job: ZodOutput<ModelType>; rawJob: string }> {
  const redisPubSub = await initRedis()

  try {
    while (true) {
      const rawJob = (await redisPubSub.sendCommand('BLMOVE', [
        queueName,
        processingQueueName,
        'LEFT',
        'RIGHT',
        0,
      ])) as string

      const jobData = JSON.parse(rawJob)
      const job = jobModel.parse(jobData)
      yield { job, rawJob }
    }
  } finally {
    redisPubSub.close()
  }
}

export async function queueAudioJob(jobDesc: Omit<AudioJob, 'jobId'>) {
  const job: AudioJob = { ...jobDesc, jobId: generateId() }
  const jobState: JobState = { ...job, state: { status: 'queued' } }

  // Set the initial job state
  await redisClient.set(
    `project:${job.projectId}.job.${job.jobId}`,
    JSON.stringify(jobState),
  )

  // Enqueue the job
  await redisClient.lpush(AUDIO_QUEUE_NAME, JSON.stringify(job))

  // Notify that job was created
  await redisClient.publish(
    `project:${job.projectId}.job`,
    JSON.stringify({
      type: 'job-created',
      job: jobState,
    }),
  )
  return job
}

export async function updateJobStatus(job: Job, state: JobStatus) {
  const { projectId, jobId } = job
  const jobState: JobState = {
    ...job,
    state,
  }

  await redisClient.setex(
    `project:${projectId}.job.${jobId}`,
    JOB_STATE_TTL,
    JSON.stringify(jobState),
  )
  await redisClient.publish(
    `project:${projectId}.job`,
    JSON.stringify({ type: 'job-status', job: jobState }),
  )
}

export function serializeJobInfo(jobData: JobState): JobInfo {
  return pick(jobData, ['jobId', 'projectId', 'trackId', 'task', 'state'])
}

export async function getJobInfo(
  projectId: string,
): Promise<Record<string, JobInfo>> {
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
      jobs[jobData.jobId] = serializeJobInfo(jobData)
    }
  } while (nextCursor != 0)

  return jobs
}

export async function createJobKey(rawJob: string) {
  const jobKey = generateJobKey()
  await redisClient.setex(`job.key:${jobKey}`, JOB_KEY_TTL, rawJob)
  return jobKey
}

export async function getJobKey(jobKey: string) {
  return await redisClient.get(`job.key:${jobKey}`)
}

export async function deleteJobKey(jobKey: string) {
  return await redisClient.del(`job.key:${jobKey}`)
}
