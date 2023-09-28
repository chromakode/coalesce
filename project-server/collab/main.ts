// NOTE: All editors of a project must be connected to the same collab server
// instance. A hash ring load balancer keyed by the Coalesce-Project (or
// projectId query string for websockets) is recommended.
import {
  Application,
  Middleware,
  Router,
  fetchRequestHandler,
} from '../deps.ts'
import { requireEnv, socketReady } from '../lib/utils.ts'
import { getCollab } from './collab.ts'
import * as rpc from './rpc.ts'
import { initMinio, initRedis } from '../lib/service.ts'

const COLLAB_SERVER_PORT = Number(requireEnv('COLLAB_SERVER_PORT'))

export const redisClient = await initRedis()
export const minioClient = await initMinio()

interface ContextState {
  projectId: string
}

const app = new Application<ContextState>()

const readProjectId: Middleware = async (ctx, next) => {
  const projectId =
    ctx.request.url.searchParams.get('project') ??
    ctx.request.headers.get('Coalesce-Project')

  if (!projectId) {
    ctx.response.status = 400
    return
  }

  ctx.state.projectId = projectId
  await next()
}

const router = new Router<ContextState>()
  .use(readProjectId)
  .get('/ws', async (ctx) => {
    const { projectId } = ctx.state

    if (!ctx.isUpgradable) {
      ctx.throw(501)
    }

    const ws = ctx.upgrade()
    await socketReady(ws)
    const collab = await getCollab(projectId)
    await collab.runCollabSocket(ws)
  })
  .all('/trpc/(.*)', async (ctx) => {
    const res = await fetchRequestHandler({
      endpoint: '/trpc',
      req: new Request(ctx.request.url, {
        headers: ctx.request.headers,
        body:
          ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD'
            ? ctx.request.body({ type: 'stream' }).value
            : void 0,
        method: ctx.request.method,
      }),
      router: rpc.rpcRouter,
      createContext: rpc.createContext,
    })
    ctx.response.status = res.status
    ctx.response.headers = res.headers
    ctx.response.body = res.body
  })

app.use(router.routes())
app.use(router.allowedMethods())

await app.listen({ port: COLLAB_SERVER_PORT })
