import { Application, Middleware, Router, oakCors, ory } from '../deps.ts'
import { APP_ORIGIN, PROJECT_SERVER_PORT } from './env.ts'
import {
  watchProject,
  getProjectInfo,
  updateProject,
  updateTrack,
  createTrack,
  canAccessProject,
  streamTrackChunk,
  createProject,
  listProjects,
  getTrackInfo,
  removeTrackFromProject,
  projectContainsTrack,
  isValidProjectGuestKey,
} from './store.ts'
import { ProjectFields, TrackFields } from '@shared/schema'
import { initMinio, initOry, initPostgres, initRedis } from '../lib/service.ts'
import { pushProjectUpdates, runCollab } from './socket.ts'
import { consumeAudioJobs, workerProxyRouter } from './audioWorkerProxy.ts'
import { socketReady } from '../lib/utils.ts'
import { SessionInfo } from '@shared/types'

export const db = await initPostgres()
export const redisClient = await initRedis()
export const minioClient = await initMinio()
export const auth = initOry()

interface ContextState {
  identity: ory.Identity
}

const loadSession: Middleware = async (ctx, next) => {
  try {
    const resp = await auth.toSession({
      cookie: ctx.request.headers.get('cookie') ?? '',
    })

    const { identity } = resp.data
    if (!identity) {
      console.error('Missing identity data')
      ctx.response.status = 500
      return
    }

    ctx.state.identity = identity
  } catch (err) {
    if (err.response?.status !== 401) {
      console.error('Unexpected error getting Kratos session', err)
      ctx.response.status = 500
      return
    }
  }
  await next()
}

const requireSession: Middleware = async (ctx, next) => {
  if (!ctx.state.identity) {
    ctx.response.status = 401
    return
  }
  await next()
}

const app = new Application<ContextState>()

const trackRouter = new Router<
  ContextState & { project: string; track: string }
>()
  .put('/', async (ctx) => {
    const body = await ctx.request.body({ type: 'json' }).value
    const fields = TrackFields.parse(body)
    await updateTrack(ctx.state.project, ctx.state.track, fields)
    ctx.response.status = 200
  })
  .delete('/', async (ctx) => {
    await removeTrackFromProject(ctx.state.project, ctx.state.track)
    ctx.response.status = 200
  })
  .get(`/:chunk(\\d+\.flac)`, async (ctx) => {
    const { track, chunk } = ctx.params
    const resp = await streamTrackChunk(track, chunk)
    ctx.response.body = resp
  })

const projectRouter = new Router<ContextState & { project: string }>()
  .get('/ws', async (ctx) => {
    const { project } = ctx.state

    if (!ctx.isUpgradable) {
      ctx.throw(501)
    }

    const ws = ctx.upgrade()
    await socketReady(ws)
    await pushProjectUpdates(project, ws)
  })
  .get('/collab', async (ctx) => {
    const { project } = ctx.state

    if (!ctx.isUpgradable) {
      ctx.throw(501)
    }

    const ws = ctx.upgrade()
    await socketReady(ws)
    await runCollab(project, ws)
  })
  .put('/', async (ctx) => {
    const body = await ctx.request.body({ type: 'json' }).value
    const fields = ProjectFields.parse(body)
    await updateProject(ctx.state.project, fields)
    ctx.response.body = await getProjectInfo(ctx.state.project)
  })
  .post(`/track`, async (ctx) => {
    const fileData = ctx.request.body({ type: 'stream' })
    const trackId = await createTrack(
      ctx.state.project,
      fileData,
      ctx.request.url.searchParams.get('filename') ?? 'unknown',
    )
    ctx.response.body = await getTrackInfo(trackId)
  })
  .use(
    '/track/:track(\\w+)',
    async (ctx, next) => {
      const { track } = ctx.params

      // Since access control is per-project, we must verify the track exists
      // within the project (which determines that the user has access to it).
      const exists = await projectContainsTrack(ctx.state.project, track)
      if (!exists) {
        ctx.response.status = 404
        return
      }

      ctx.state.track = track

      await next()
    },
    trackRouter.routes(),
    trackRouter.allowedMethods(),
  )

const apiRouter = new Router<ContextState>()
  .use(loadSession)
  .use(
    '/project/:project(\\w+)',
    async (ctx, next) => {
      const project = ctx.params.project
      const { identity } = ctx.state as ContextState // FIXME: why isn't this inferred?

      const isValidUser =
        identity && (await canAccessProject(project, identity.id))

      const authHeader = ctx.request.headers.get('Authorization')
      const guestKey =
        authHeader && authHeader.startsWith('Bearer')
          ? authHeader.split(' ')[1]
          : ctx.request.url.searchParams.get('guestEditKey')
      const isValidGuest =
        guestKey && (await isValidProjectGuestKey(project, guestKey))

      if (isValidUser || isValidGuest) {
        ctx.state.project = project
        await next()
        return
      }

      ctx.response.status = 401
    },
    projectRouter.routes(),
    projectRouter.allowedMethods(),
  )
  .use(requireSession)
  .get('/session', async (ctx) => {
    const { identity } = ctx.state
    const { data: flow } = await auth.createBrowserLogoutFlow({
      cookie: ctx.request.headers.get('cookie') ?? '',
    })
    const sessionInfo: SessionInfo = {
      userId: identity.id,
      email: identity.traits.email,
      logoutURL: flow.logout_url,
    }
    ctx.response.body = sessionInfo
  })
  .get('/project', async (ctx) => {
    const { identity } = ctx.state
    const projects = await listProjects(identity.id)
    ctx.response.body = projects
  })
  .post('/project', async (ctx) => {
    const { identity } = ctx.state
    const body = await ctx.request.body({ type: 'json' }).value
    const fields = ProjectFields.parse(body)
    const projectId = await createProject(fields, identity.id)

    watchProject(projectId)

    ctx.response.body = await getProjectInfo(projectId)
  })

app.use(oakCors({ origin: APP_ORIGIN }))
app.use(apiRouter.routes())
app.use(workerProxyRouter.routes())

await Promise.all([
  app.listen({ port: PROJECT_SERVER_PORT }),
  consumeAudioJobs(),
])
