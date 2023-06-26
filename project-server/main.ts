import { Application, Router, oakCors } from './deps.ts'
import { APP_ORIGIN, PROJECT_SERVER_PORT } from './env.ts'
import {
  getProjectState,
  watchProject,
  listProjects,
  getProjectInfo,
  updateProject,
  updateTrack,
  createTrack,
  deleteTrack,
  generateId,
  projectExists,
  streamTrackChunk,
} from './store.ts'
import { ProjectParams, TrackParams } from '../shared/schema.ts'
import { initMinio, initRedis } from './service.ts'

export const redisClient = await initRedis()
export const minioClient = await initMinio()

const app = new Application()

const projectRouter = new Router()
  .get('/ws', async (ctx) => {
    if (!ctx.isUpgradable) {
      ctx.throw(501)
    }

    const ws = ctx.upgrade()

    const { project } = ctx.state

    const projectState = await getProjectState(project)
    ws.send(JSON.stringify({ type: 'project:data', data: projectState }))

    for await (const message of watchProject(project)) {
      ws.send(message)
    }
  })
  .put('/', async (ctx) => {
    const body = await ctx.request.body({ type: 'json' }).value
    const params = ProjectParams.parse(body)
    await updateProject(ctx.state.project, params)
    ctx.response.status = 200
  })
  .put('/track/:track(\\w+)', async (ctx) => {
    const body = await ctx.request.body({ type: 'json' }).value
    const params = TrackParams.parse(body)
    await updateTrack(ctx.state.project, ctx.params.track, params)
    ctx.response.status = 200
  })
  .delete('/track/:track(\\w+)', async (ctx) => {
    await deleteTrack(ctx.state.project, ctx.params.track)
    ctx.response.status = 200
  })
  .post(`/track`, async (ctx) => {
    const fileData = ctx.request.body({ type: 'stream' })
    const trackId = await createTrack(ctx.state.project, fileData)
    ctx.response.body = { id: trackId }
  })
  .get(`/track/:track(\\w+)/:chunk(\\d+\.flac)`, async (ctx) => {
    const { track, chunk } = ctx.params

    const resp = await streamTrackChunk(ctx.state.project, track, chunk)
    ctx.response.body = resp
  })

const router = new Router()
  .get('/project', async (ctx) => {
    const projects = await listProjects()
    ctx.response.body = projects
  })
  .post('/project', async (ctx) => {
    const projectId = generateId()

    const body = await ctx.request.body({ type: 'json' }).value
    const params = ProjectParams.parse(body)
    await updateProject(projectId, params)

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
