import { Application, Router, oakCors } from './deps.ts'
import { APP_ORIGIN, PROJECT_SERVER_PORT } from './env.ts'
import {
  watchProject,
  getProjectInfo,
  updateProject,
  updateTrack,
  createTrack,
  deleteTrack,
  projectExists,
  streamTrackChunk,
  createProject,
  listProjects,
  getTrackInfo,
} from './store.ts'
import { ProjectFields, TrackFields } from '../shared/schema.ts'
import { initMinio, initPostgres, initRedis } from './service.ts'
import { pushProjectUpdates, runCollab } from './socket.ts'

export const db = await initPostgres()
export const redisClient = await initRedis()
export const minioClient = await initMinio()

const app = new Application()

async function socketReady(ws: WebSocket) {
  if (ws.readyState !== ws.OPEN) {
    await new Promise((resolve) =>
      ws.addEventListener('open', resolve, { once: true }),
    )
  }
}

const projectRouter = new Router()
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
    ctx.response.status = 200
  })
  .put('/track/:track(\\w+)', async (ctx) => {
    const body = await ctx.request.body({ type: 'json' }).value
    const fields = TrackFields.parse(body)
    await updateTrack(ctx.state.project, ctx.params.track, fields)
    ctx.response.status = 200
  })
  .delete('/track/:track(\\w+)', async (ctx) => {
    await deleteTrack(ctx.state.project, ctx.params.track)
    ctx.response.status = 200
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
  .get(`/track/:track(\\w+)/:chunk(\\d+\.flac)`, async (ctx) => {
    const { track, chunk } = ctx.params

    const resp = await streamTrackChunk(track, chunk)
    ctx.response.body = resp
  })

const router = new Router()
  .get('/project', async (ctx) => {
    const projects = await listProjects()
    ctx.response.body = projects
  })
  .post('/project', async (ctx) => {
    const body = await ctx.request.body({ type: 'json' }).value
    const fields = ProjectFields.parse(body)
    const projectId = await createProject(fields)

    watchProject(projectId)

    ctx.response.body = await getProjectInfo(projectId)
  })
  .use(
    '/project/:project(\\w+)',
    async (ctx, next) => {
      const project = ctx.params.project

      const exists = await projectExists(project)
      if (!exists) {
        ctx.response.status = 404
        return
      }

      ctx.state.project = project

      await next()
    },
    projectRouter.routes(),
    projectRouter.allowedMethods(),
  )

app.use(oakCors({ origin: APP_ORIGIN }))

app.use(router.routes())

app.listen({ port: PROJECT_SERVER_PORT })
