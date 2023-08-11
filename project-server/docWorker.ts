import { DocJob } from '@shared/types'
import { DOC_QUEUE_NAME, DOC_PROCESSING_QUEUE_NAME } from './env.ts'
import { addTrackToCollabDoc } from './store.ts'
import { initRedis } from './service.ts'

export async function consumeDocJobs() {
  const redisPubSub = await initRedis()

  while (true) {
    const rawJob = (await redisPubSub.sendCommand('BLMOVE', [
      DOC_QUEUE_NAME,
      DOC_PROCESSING_QUEUE_NAME,
      'LEFT',
      'RIGHT',
      0,
    ])) as string

    const job = JSON.parse(rawJob) as DocJob

    if (job.task === 'transcribe_done') {
      await addTrackToCollabDoc(job.project, job.track)
    } else {
      console.warn('Unknown doc job:', job)
    }
  }
}
