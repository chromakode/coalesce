import {
  Router,
  exponentialBuckets,
  prometheusClient,
  throttle,
  timingSafeEqual,
  unreachable,
} from '../deps.ts'
import {
  AUDIO_PROCESSING_QUEUE_NAME,
  AUDIO_QUEUE_NAME,
  WORKER_ENDPOINT,
  WORKER_KEY,
  WORKER_PROXY_ORIGIN,
} from './env.ts'
import {
  AudioJob,
  AudioJobModel,
  JobMsgModel,
  ProcessAudioRequest,
  Segment,
} from '@shared/schema'
import {
  consumeJobs,
  createJobKey,
  deleteJobKey,
  getJobKey,
  getSignedWorkerSourceAudioURL,
  getSignedWorkerUploadURL,
  updateJobStatus,
} from './worker.ts'
import { redisClient, collab } from './main.ts'
import { updateTrack } from './store.ts'
import { iterSocket, socketReady } from '../lib/utils.ts'

const audioProcessHistogram = new prometheusClient.Histogram({
  name: 'audio_process_s',
  help: 'Duration spent processing audio (seconds)',
  buckets: exponentialBuckets(10, 1.25, 20),
})
const audioProcessFailureCounter = new prometheusClient.Counter({
  name: 'audio_process_failure_count',
  help: 'Triggered by audio processing errors',
})
new prometheusClient.Gauge({
  name: 'audio_process_queue_size',
  help: 'Count of tracks waiting in the audio job queue',
  async collect() {
    const queueSize = await redisClient.llen(AUDIO_QUEUE_NAME)
    this.set(queueSize)
  },
})
const audioProcessRunningCountGauge = new prometheusClient.Gauge({
  name: 'audio_process_running_count',
  help: 'Count of running audio processes',
})

async function requestHTTPWorker(req: ProcessAudioRequest): Promise<Response> {
  const workerURL = `${WORKER_ENDPOINT}/process-audio/${req.jobId}`
  return await fetch(workerURL, {
    method: 'POST',
    body: JSON.stringify(req),
    headers: {
      Authorization: `Bearer ${WORKER_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

async function requestRunPodWorker(
  req: ProcessAudioRequest,
): Promise<Response> {
  const workerURL = WORKER_ENDPOINT.replace(/^runpod:/, '')
  return await fetch(workerURL, {
    method: 'POST',
    body: JSON.stringify({ input: req }),
    headers: {
      Authorization: `Bearer ${WORKER_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

async function startWorker(job: AudioJob, rawJob: string) {
  const { jobId, projectId, trackId } = job
  const jobKey = await createJobKey(rawJob)
  const baseURI = `${WORKER_PROXY_ORIGIN}/worker/job/${job.jobId}`

  const processAudioRequest: ProcessAudioRequest = {
    jobId,
    jobKey,
    statusURI: `${baseURI.replace(/^http/, 'ws')}/ws`,
    inputURI: `${baseURI}/audio`,
    outputURIBase: `${baseURI}/output`,
  }

  const makeRequest = WORKER_ENDPOINT.startsWith('runpod:')
    ? requestRunPodWorker
    : requestHTTPWorker

  // TODO: retry on failure
  const result = await makeRequest(processAudioRequest)
  if (!result.ok) {
    throw new Error(
      `Error status from worker: ${result.status} ${result.statusText} (${result.url})`,
    )
  }

  await collab
    .rpc(projectId)
    .handleTranscribeStatus.mutate({ trackId, status: 'running' })
}

async function runWorkerSocket(
  ws: WebSocket,
  jobKey: string,
  job: AudioJob,
  rawJob: string,
) {
  const { projectId, trackId } = job
  let segmentQueue: Segment[] = []

  const queueAddSegments = throttle(async () => {
    const segments = segmentQueue
    segmentQueue = []
    await collab
      .rpc(projectId)
      .handleTranscribeWords.mutate({ trackId, segments })
  }, 5 * 1000)

  audioProcessRunningCountGauge.inc()
  const endTimer = audioProcessHistogram.startTimer()

  try {
    for await (const ev of iterSocket(ws)) {
      const data = JSON.parse(ev.data)
      const msg = JobMsgModel.parse(data)

      // TODO: for reconnect reliability, ack received segments, have worker
      // replay non-acked segments on reconnect.
      if (msg.kind === 'metadata') {
        await updateTrack(projectId, trackId, { audioMetadata: msg.data })
      } else if (msg.kind === 'segment') {
        const segment = msg.data
        segmentQueue.push(segment)
        queueAddSegments()
      } else if (msg.kind === 'status') {
        const update = msg.data

        await updateJobStatus(job, update)

        if (update.status === 'complete') {
          // If processing is successful, remove the message from the processing queue
          await redisClient.lrem(AUDIO_PROCESSING_QUEUE_NAME, 0, rawJob)
        } else if (update.status === 'failed') {
          console.error('Job failed:', update.error, job)
        }

        if (update.status === 'complete' || update.status === 'failed') {
          await collab
            .rpc(projectId)
            .handleTranscribeStatus.mutate({ trackId, status: update.status })
          await deleteJobKey(jobKey)
          ws.close()
          return
        }
      } else {
        unreachable()
      }
    }
  } catch (err) {
    console.error('Error handling worker socket:', err, job)
    audioProcessFailureCounter.inc()
  } finally {
    endTimer()
    audioProcessRunningCountGauge.dec()
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

interface RequestContext {
  jobKey: string
  job: AudioJob
  rawJob: string
}

const proxyRouter = new Router<RequestContext>()
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
    const audioURL = await getSignedWorkerSourceAudioURL(job.trackId)
    ctx.response.redirect(audioURL)
  })
  .put('/output/:filename(\\w+\\.(?:json|flac))', async (ctx) => {
    const { job } = ctx.state
    const uploadURL = await getSignedWorkerUploadURL(
      job.trackId,
      ctx.params.filename,
    )
    ctx.response.redirect(uploadURL)
  })

export const workerProxyRouter = new Router<RequestContext>().use(
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

    const enc = new TextEncoder()
    if (!timingSafeEqual(enc.encode(job.jobId), enc.encode(jobId))) {
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
