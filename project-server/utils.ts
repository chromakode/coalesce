import { EventIterator, abortableSource } from './deps.ts'

export async function socketReady(ws: WebSocket) {
  if (ws.readyState !== ws.OPEN) {
    await new Promise((resolve) =>
      ws.addEventListener('open', resolve, { once: true }),
    )
  }
}

export function iterSocket(ws: WebSocket) {
  return new EventIterator<MessageEvent>((queue) => {
    ws.onmessage = queue.push
    ws.onclose = queue.stop
    ws.onerror = () => queue.fail(new Error('WebSocket error'))
    return () => {
      ws.close()
    }
  })
}

export function cancelable<T>(
  iter: AsyncIterable<T>,
  fn: (val: T) => Promise<void>,
): () => void {
  const controller = new AbortController()

  async function doIter() {
    try {
      // @ts-expect-error(Deno's AbortSignal type doesn't have all the DOM event methods abortable-iterator expects)
      for await (const msg of abortableSource(iter, controller.signal)) {
        fn(msg)
      }
    } catch (err) {
      if (err.code === 'ABORT_ERR') {
        return
      }
      throw err
    }
  }

  doIter()

  return () => controller.abort()
}
