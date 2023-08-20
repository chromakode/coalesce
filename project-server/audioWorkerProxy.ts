import { path, Router } from './deps.ts'
import {
  APP_ORIGIN,
  AUDIO_PROCESSING_QUEUE_NAME,
  AUDIO_QUEUE_NAME,
  WORKER_ENDPOINT,
  WORKER_KEY,
  WORKER_PROXY_ORIGIN,
} from './env.ts'
import {
  AudioJob,
  AudioJobModel,
  JobStatusUpdate,
  ProcessAudioRequest,
} from '../shared/schema.ts'
import { initMinio, initRedis } from './service.ts'
import {
  consumeJobs,
  createJobKey,
  deleteJobKey,
  getJobKey,
  updateJobStatus,
} from './store/worker.ts'
import { addTrackToCollabDoc } from './store/index.ts'
import { iterSocket, socketReady } from './utils.ts'

export const redisClient = await initRedis()
export const minioClient = await initMinio()

async function startWorker(job: AudioJob, rawJob: string) {
  const { jobId } = job
  const jobKey = await createJobKey(rawJob)
  const baseURI = `${WORKER_PROXY_ORIGIN}/worker/job/${job.jobId}`

  const processAudioRequest: ProcessAudioRequest = {
    jobId,
    jobKey,
    statusURI: `${baseURI.replace(/^http/, 'ws')}/ws`,
    inputURI: `${baseURI}/audio`,
    outputURIBase: `${baseURI}/output`,
  }

  // TODO: retry on failure
  const workerURL = `${WORKER_ENDPOINT}/process-audio/${jobId}`
  const result = await fetch(workerURL, {
    method: 'POST',
    body: JSON.stringify(processAudioRequest),
    headers: {
      Authorization: `Bearer ${WORKER_KEY}`,
      'Content-Type': 'application/json',
    },
  })

  if (!result.ok) {
    throw new Error(
      `Error status from worker: ${result.status} ${result.statusText} (${workerURL})`,
    )
  }
}

async function runWorkerSocket(
  ws: WebSocket,
  jobKey: string,
  job: AudioJob,
  rawJob: string,
) {
  const { projectId, trackId } = job

  try {
    for await (const ev of iterSocket(ws)) {
      const data = JSON.parse(ev.data)
      const update = JobStatusUpdate.parse(data)

      await updateJobStatus(job, update)

      if (update.status === 'complete') {
        // If processing is successful, remove the message from the processing queue
        await redisClient.lrem(AUDIO_PROCESSING_QUEUE_NAME, 0, rawJob)
        await deleteJobKey(jobKey)
        await addTrackToCollabDoc(projectId, trackId)
      } else if (update.status === 'failed') {
        console.error('Job failed:', update.error, job)
      }
    }
  } catch (err) {
    console.error('Error handling worker socket:', err, job)
  }
}

// TODO: cancelable jobs
export async function consumeAudioJobs() {
  for await (const { job, rawJob } of consumeJobs(
    AUDIO_QUEUE_NAME,
    AUDIO_PROCESSING_QUEUE_NAME,
    AudioJobModel,
  )) {
    if (job.task === 'process') {
      try {
        await startWorker(job, rawJob)
      } catch (err) {
        console.error('Error starting job', err, job)
        await updateJobStatus(job, { status: 'failed', error: err.toString() })
      }
    } else {
      console.warn('Unknown audio job:', job)
    }
  }
}

interface JobState {
  jobKey: string
  job: AudioJob
  rawJob: string
}

const proxyRouter = new Router<JobState>()
  .get('/ws', async (ctx) => {
    if (!ctx.isUpgradable) {
      ctx.throw(501)
    }

    const { jobKey, job, rawJob } = ctx.state
    const ws = ctx.upgrade()
    await socketReady(ws)
    await runWorkerSocket(ws, jobKey, job, rawJob)
  })
  .get('/audio', async (ctx) => {
    const { job } = ctx.state
    const resp = await fetch(job.inputURI)
    ctx.response.type = resp.headers.get('Content-Type') ?? 'audio/flac'
    ctx.response.body = resp.body
    ctx.response.status = resp.status
    if (!resp.ok) {
      console.error('Failed to fetch audio', resp.status, resp.statusText)
    }
  })
  .post('/output/:filename(\\w+\\.(?:json|flac))', async (ctx) => {
    const { job } = ctx.state

    const contentType =
      ctx.request.headers.get('Content-Type') ?? 'application/octet-stream'
    const fileData = await ctx.request.body({ type: 'bytes' }).value

    const formData = new FormData()
    for (const [key, value] of Object.entries(job.outputFormData)) {
      formData.append(key, value)
    }
    const blob = new Blob([fileData], { type: contentType })
    formData.append('file', blob, ctx.params.filename)

    const resp = await fetch(job.outputURI, {
      method: 'POST',
      body: formData,
    })

    if (!resp.ok) {
      console.error('Failed to upload job output', resp.status, resp.statusText)
    }
    ctx.response.status = resp.status
  })

export const workerProxyRouter = new Router<JobState>().use(
  '/worker/job/:jobId',
  async (ctx, next) => {
    const { jobId } = ctx.params

    const jobKey = ctx.request.headers.get('Authorization')
    if (!jobKey?.startsWith('Bearer ')) {
      ctx.response.status = 401
      console.warn('Missing authentication', ctx.request)
      return
    }

    const rawJob = await getJobKey(jobKey.split(' ')[1])
    if (!rawJob) {
      ctx.response.status = 403
      console.warn('Unknown job key', ctx.request)
      return
    }

    const job = AudioJobModel.parse(JSON.parse(rawJob))
    if (job.jobId !== jobId) {
      ctx.response.status = 403
      console.warn('Incorrect job id', ctx.request)
      return
    }

    ctx.state.jobKey = jobKey
    ctx.state.rawJob = rawJob
    ctx.state.job = job

    await next()
  },
  proxyRouter.routes(),
  proxyRouter.allowedMethods(),
)