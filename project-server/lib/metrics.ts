import { Application, Router, prometheusClient } from '../deps.ts'
import { requireEnv } from './utils.ts'

export async function serveMetrics() {
  const METRICS_SERVER_PORT = Number(requireEnv('METRICS_SERVER_PORT'))
  const app = new Application()
  const router = new Router().get('/metrics', async (ctx) => {
    ctx.response.body = await prometheusClient.register.metrics()
  })
  app.use(router.routes(), router.allowedMethods())
  await app.listen({ port: METRICS_SERVER_PORT })
}
