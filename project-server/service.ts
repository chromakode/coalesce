import { Minio, S3Client, S3Errors, redis } from './deps.ts'

import { REDIS_URL, MINIO_ENDPOINT } from './env.ts'

export async function initRedis() {
  return await redis.connect(redis.parseURL(REDIS_URL))
}

const minioURL = new URL(MINIO_ENDPOINT)
export const bucket = minioURL.pathname.substring(1)

export async function initMinio() {
  const client = await new S3Client({
    endPoint: minioURL.hostname,
    port: Number(minioURL.port),
    accessKey: minioURL.username,
    secretKey: minioURL.password,
    region: '',
    bucket,
    useSSL: false,
  })

  try {
    await client.makeRequest({
      method: 'PUT',
      payload: '',
      bucketName: bucket,
      objectName: '',
    })
  } catch (err) {
    if (
      err instanceof S3Errors.ServerError &&
      err.code === 'BucketAlreadyOwnedByYou'
    ) {
      // Bucket already exists, that's ok!
    } else {
      throw err
    }
  }

  return client
}

export function initMinioJS() {
  return new Minio.Client({
    endPoint: minioURL.hostname,
    port: Number(minioURL.port),
    accessKey: minioURL.username,
    secretKey: minioURL.password,
    useSSL: false,
  })
}
