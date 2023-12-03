import {
  ProjectTable,
  TrackTable,
  ProjectTracksTable,
  ProjectUsersTable,
} from '@shared/schema'
import {
  Kysely,
  Migrator,
  PostgresDialect,
  Minio,
  pg,
  redis,
  path,
  MigrationProvider,
  Migration,
  CamelCasePlugin,
  ory,
} from '../deps.ts'

import { requireEnv } from './utils.ts'
import { CollabCluster } from './CollabCluster.ts'

export interface DB {
  project: ProjectTable
  track: TrackTable
  projectTracks: ProjectTracksTable
  projectUsers: ProjectUsersTable
}

class DenoFileMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {}
    const dirPath = path.join(
      path.dirname(path.fromFileUrl(import.meta.url)),
      '../migrations',
    )

    for await (const file of await Deno.readDir(dirPath)) {
      migrations[file.name] = await import(path.join(dirPath, file.name))
    }

    return migrations
  }
}

export type ProjectDB = Kysely<DB>

export async function initPostgres(): Promise<ProjectDB> {
  const POSTGRES_URL = requireEnv('POSTGRES_URL')

  // Work around https://github.com/denoland/deno/issues/20293
  let connectionString = POSTGRES_URL
  let ssl
  const connectionURL = new URL(POSTGRES_URL)
  if (connectionURL.searchParams.get('sslmode') === 'verify-full') {
    connectionURL.searchParams.delete('sslmode')
    connectionString = connectionURL.toString()
    ssl = { host: new URL(POSTGRES_URL).hostname }
  }

  const dialect = new PostgresDialect({
    pool: new pg.Pool({ connectionString, ssl }),
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
  const REDIS_URL = requireEnv('REDIS_URL')
  return await redis.connect(redis.parseURL(REDIS_URL))
}

export async function initMinio() {
  const MINIO_ENDPOINT = requireEnv('MINIO_ENDPOINT')
  const minioURL = new URL(MINIO_ENDPOINT)
  const minioBucket = minioURL.pathname.substring(1)

  const minioClient = new Minio.Client({
    endPoint: minioURL.hostname,
    port: minioURL.port ? Number(minioURL.port) : undefined,
    accessKey: decodeURIComponent(minioURL.username),
    secretKey: decodeURIComponent(minioURL.password),
    region: minioURL.searchParams.get('region') ?? '',
    useSSL: minioURL.protocol === 'https:',
    pathStyle: minioURL.searchParams.get('useVHostStyleURLs') ? false : true,
  })

  try {
    await minioClient.makeBucket(minioBucket)
  } catch (err) {
    if (
      err.code === 'BucketAlreadyOwnedByYou' || // Minio
      err.code === 'AccessDenied' || // B2
      err.code === 'BucketAlreadyExists' // DigitalOcean Space
    ) {
      // Bucket already exists, that's ok!
    } else {
      throw err
    }
  }

  return { minioClient, minioBucket }
}

export function initOry() {
  const KRATOS_URL = requireEnv('KRATOS_URL')
  return new ory.FrontendApi(
    new ory.Configuration({
      basePath: KRATOS_URL,
    }),
  )
}

export function initOryAdmin() {
  const KRATOS_ADMIN_URL = requireEnv('KRATOS_ADMIN_URL')
  return new ory.IdentityApi(
    new ory.Configuration({
      basePath: KRATOS_ADMIN_URL,
    }),
  )
}

export function initCollabCluster() {
  const COLLAB_ENDPOINT = requireEnv('COLLAB_ENDPOINT')
  return new CollabCluster(COLLAB_ENDPOINT)
}
