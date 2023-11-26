// NOTE: All editors of a project must be connected to the same collab server
// instance. A hash ring load balancer keyed by the Coalesce-Project (or
// projectId query string for websockets) is recommended.
import { Application, Router, fetchRequestHandler } from '../deps.ts'
import {
  generateShortId,
  iterSocket,
  requireEnv,
  socketReady,
} from '../lib/utils.ts'
import { getCollab } from './collab.ts'
import * as rpc from './rpc.ts'
import { initMinio, initRedis } from '../lib/service.ts'

const COLLAB_SERVER_PORT = Number(requireEnv('COLLAB_SERVER_PORT'))

export const redisClient = await initRedis()
export const { minioClient, minioBucket } = await initMinio()

export const instanceId =
  Deno.env.get('COLLAB_INSTANCE_ID') ?? generateShortId()

interface ContextState {
  projectId: string
}

const app = new Application<ContextState>()

const projectRouter = new Router<ContextState>()
  .get('/ws', async (ctx) => {
    const { projectId } = ctx.state

    if (!ctx.isUpgradable) {
      ctx.throw(501)
    }

    const ws = ctx.upgrade()
    ws.binaryType = 'arraybuffer'

    await socketReady(ws)

    // Start queueing messages immediately while we load the doc
    const clientMessages = iterSocket(ws)

    const collab = await getCollab(projectId)
    await collab.runCollabSocket(ws, clientMessages)
  })
  .all('/trpc/(.*)', async (ctx) => {
    const { projectId } = ctx.state
    const res = await fetchRequestHandler({
      endpoint: `/project/${projectId}/trpc`,
      req: new Request(ctx.request.url, {
        headers: ctx.request.headers,
        body:
          ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD'
            ? ctx.request.body({ type: 'stream' }).value
            : void 0,
        method: ctx.request.method,
      }),
      router: rpc.rpcRouter,
      createContext: rpc.createContextForProject(projectId),
    })
    ctx.response.status = res.status
    ctx.response.headers = res.headers
    ctx.response.body = res.body
  })

const router = new Router()
  .get('/health', (ctx) => {
    ctx.response.status = 200
  })
  .use(
    '/project/:projectId(\\w+)',
    async (ctx, next) => {
      const projectId = ctx.params.projectId

      if (!projectId) {
        ctx.response.status = 400
        return
      }

      ctx.state.projectId = projectId
      await next()
    },
    projectRouter.routes(),
    projectRouter.allowedMethods(),
  )

app.use(router.routes())
app.use(router.allowedMethods())

await app.listen({ port: COLLAB_SERVER_PORT })
