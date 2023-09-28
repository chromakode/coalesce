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
  S3Client,
  S3Errors,
  pg,
  redis,
  path,
  MigrationProvider,
  Migration,
  CamelCasePlugin,
  ory,
  createTRPCProxyClient,
  httpLink,
} from '../deps.ts'

import { requireEnv } from './utils.ts'
import { CollabRPCRouter } from '../collab/rpc.ts'

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

export async function initPostgres() {
  const POSTGRES_URL = requireEnv('POSTGRES_URL')

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
  const REDIS_URL = requireEnv('REDIS_URL')
  return await redis.connect(redis.parseURL(REDIS_URL))
}

export async function initMinio() {
  const MINIO_ENDPOINT = requireEnv('MINIO_ENDPOINT')
  const minioURL = new URL(MINIO_ENDPOINT)
  const bucket = minioURL.pathname.substring(1)

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

export function initCollab() {
  const COLLAB_RPC_ENDPOINT = requireEnv('COLLAB_RPC_ENDPOINT')
  return createTRPCProxyClient<CollabRPCRouter>({
    links: [
      httpLink({
        url: COLLAB_RPC_ENDPOINT,
        headers: (opts) => ({
          'Coalesce-Project': opts.op.context.projectId as string,
        }),
      }),
    ],
  })
}
