import { requireEnv } from '../lib/utils.ts'

export const PROJECT_SERVER_PORT = Number(requireEnv('PROJECT_SERVER_PORT'))
export const AUDIO_QUEUE_NAME = requireEnv('AUDIO_QUEUE_NAME')
export const AUDIO_PROCESSING_QUEUE_NAME = requireEnv(
  'AUDIO_PROCESSING_QUEUE_NAME',
)
export const APP_ORIGIN = requireEnv('APP_ORIGIN')

export const COLLAB_WS_ENDPOINT = requireEnv('COLLAB_WS_ENDPOINT')

export const WORKER_PROXY_ORIGIN = requireEnv('WORKER_PROXY_ORIGIN')
export const WORKER_ENDPOINT = requireEnv('WORKER_ENDPOINT')
export const WORKER_KEY = requireEnv('WORKER_KEY')

export type DevFlag = 'reuse-track-by-filename'
const devFlagsRaw = Deno.env.get('COALESCE_DEV_FLAGS') ?? ''
export const COALESCE_DEV_FLAGS = new Set(devFlagsRaw.split(',') as DevFlag[])
