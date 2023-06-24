export function requireEnv(name: string): string {
  const val = Deno.env.get(name)
  if (!val) {
    throw new Error(`required env variable "${name}" unset`)
  }
  return val
}

export const PROJECT_SERVER_PORT = Number(requireEnv('PROJECT_SERVER_PORT'))
export const REDIS_URL = requireEnv('REDIS_URL')
export const QUEUE_NAME = requireEnv('QUEUE_NAME')
export const PROCESSING_QUEUE_NAME = requireEnv('PROCESSING_QUEUE_NAME')
export const PROJECT_DIR = requireEnv('PROJECT_DIR')
export const APP_ORIGIN = requireEnv('APP_ORIGIN')
