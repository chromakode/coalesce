import { Application, Middleware, Router, oakCors, ory } from '../deps.ts'
import { APP_ORIGIN, PROJECT_SERVER_PORT, TRACK_CDN_HOST } from './env.ts'
import {
  watchProject,
  updateProject,
  updateTrack,
  createTrack,
  canAccessProject,
  streamTrackChunk,
  createProject,
  removeTrackFromProject,
  projectContainsTrack,
  isValidProjectGuestKey,
  getProjectState,
  getSignedTrackChunkURL,
} from './store.ts'
import { getProjectInfo, listProjects, getTrackInfo } from '../lib/queries.ts'
import { ProjectFields, TrackFields } from '@shared/schema'
import {
  initCollabCluster,
  initMinio,
  initOry,
  initRedis,
} from '../lib/service.ts'
import { consumeAudioJobs, workerProxyRouter } from './audioWorkerProxy.ts'
import { socketReady } from '../lib/utils.ts'
import { SessionInfo } from '@shared/types'

export const redisClient = await initRedis()
export const { minioClient, minioBucket } = await initMinio()
export const auth = initOry()
export const collab = initCollabCluster()

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
  .patch('/', async (ctx) => {
    const body = await ctx.request.body({ type: 'json' }).value
    const fields = TrackFields.partial().parse(body)
    await updateTrack(ctx.state.project, ctx.state.track, fields)
    ctx.response.status = 204
  })
  .delete('/', async (ctx) => {
    await removeTrackFromProject(ctx.state.project, ctx.state.track)
    ctx.response.status = 204
  })
  .get(`/:chunk(\\d+\.flac)`, async (ctx) => {
    const { track, chunk } = ctx.params
    if (TRACK_CDN_HOST) {
      const signedURL = await getSignedTrackChunkURL(track, chunk)
      const trackURL = new URL(signedURL)
      trackURL.host = TRACK_CDN_HOST
      ctx.response.redirect(trackURL.toString())
      return
    }

    const { stream, headers } = await streamTrackChunk(track, chunk)

    ctx.response.body = stream
    ctx.response.headers.set('Cache-Control', 'max-age=604800, immutable')
    for (const header of [
      'Content-Length',
      'Content-Type',
      'Last-Modified',
      'ETag',
    ]) {
      const headerValue = headers[header]
      if (headerValue) {
        ctx.response.headers.set(header, headerValue)
      }
    }
  })

const projectRouter = new Router<ContextState & { project: string }>()
  .get('/ws', async (ctx) => {
    const { project } = ctx.state

    if (!ctx.isUpgradable) {
      ctx.throw(501)
    }

    const ws = ctx.upgrade()
    await socketReady(ws)

    const projectState = await getProjectState(project)
    ws.send(JSON.stringify({ type: 'project:data', data: projectState }))

    for await (const message of watchProject(project)) {
      ws.send(message)
    }
  })
  .get('/collab', async (ctx) => {
    const { project } = ctx.state

    if (!ctx.isUpgradable) {
      ctx.throw(501)
    }

    const ws = ctx.upgrade()
    const upstreamWS = collab.socket(project)

    upstreamWS.onmessage = async (ev) => {
      await socketReady(ws)
      ws.send(ev.data)
    }
    ws.onmessage = async (ev) => {
      await socketReady(upstreamWS)
      upstreamWS.send(ev.data)
    }
    upstreamWS.onclose = () => {
      ws.close()
    }
    ws.onclose = () => {
      upstreamWS.close()
    }
  })
  .patch('/', async (ctx) => {
    const body = await ctx.request.body({ type: 'json' }).value
    const fields = ProjectFields.partial().parse(body)
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
    ctx.response.body = await getTrackInfo(ctx.state.project, trackId)
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
  .get('/health', (ctx) => {
    ctx.response.status = 200
  })
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

app.use(oakCors({ origin: APP_ORIGIN, credentials: true }))
app.use(apiRouter.routes())
app.use(apiRouter.allowedMethods())
app.use(workerProxyRouter.routes())
app.use(workerProxyRouter.allowedMethods())

await Promise.all([
  app.listen({ port: PROJECT_SERVER_PORT }),
  consumeAudioJobs(),
])
