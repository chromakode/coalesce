import {
  ProjectTable,
  TrackTable,
  ProjectTracksTable,
} from '../shared/schema.ts'
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
} from './deps.ts'

import { REDIS_URL, MINIO_ENDPOINT, POSTGRES_URL } from './env.ts'

export interface DB {
  project: ProjectTable
  track: TrackTable
  projectTracks: ProjectTracksTable
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

export async function initRedis() {
  return await redis.connect(redis.parseURL(REDIS_URL))
}

const minioURL = new URL(MINIO_ENDPOINT)
export const bucket = minioURL.pathname.substring(1)

export async function initMinio() {
  const client = await new S3Client({
    endPoint: minioURL.hostname,
    port: minioURL.port ? Number(minioURL.port) : undefined,
    accessKey: minioURL.username,
    secretKey: minioURL.password,
    region: '',
    bucket,
    useSSL: minioURL.protocol === 'https:',
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
      (err.code === 'BucketAlreadyOwnedByYou' || // Minio
        err.code === 'AccessDenied') // B2
    ) {
      // Bucket already exists, that's ok!
    } else {
      throw err
    }
  }

  return client
}
