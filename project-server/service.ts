import { ProjectTable, TrackTable } from '../shared/schema.ts'
import {
  Kysely,
  Migrator,
  Minio,
  PostgresDialect,
  S3Client,
  S3Errors,
  pg,
  redis,
  path,
  MigrationProvider,
  Migration,
  CamelCasePlugin,
  Redlock,
} from './deps.ts'

import { REDIS_URL, MINIO_ENDPOINT, POSTGRES_URL } from './env.ts'

export interface DB {
  project: ProjectTable
  track: TrackTable
  projectTracks: {
    projectId: string
    trackId: string
  }
}

class DenoFileMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {}
    const dirPath = path.join(
      path.dirname(path.fromFileUrl(import.meta.url)),
      'migrations',
    )

    for await (const file of await Deno.readDir(dirPath)) {
      migrations[file.name] = await import(path.join(dirPath, file.name))
    }

    return migrations
  }
}

export async function initPostgres() {
  const dialect = new PostgresDialect({
    pool: new pg.Pool({ connectionString: POSTGRES_URL }),
  })

  const db = new Kysely<DB>({ dialect, plugins: [new CamelCasePlugin()] })

  const migrator = new Migrator({
    db,
    provider: new DenoFileMigrationProvider(),
  })

  const { error, results } = await migrator.migrateToLatest()

  for (const result of results ?? []) {
    console.log(`PG migration "${result.migrationName}": ${result.status}`)
  }

  if (error) {
    console.error('failed to migrate')
    console.error(error)
    Deno.exit(1)
  }

  return db
}

export function initRedis() {
  return new redis.Redis(REDIS_URL)
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

export function initRedlock(redisClient: redis.Redis) {
  return new Redlock([redisClient])
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
