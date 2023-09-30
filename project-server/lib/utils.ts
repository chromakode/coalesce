import * as NodeStream from 'node:stream'
import * as NodeStreamWeb from 'node:stream/web'
import { EventIterator, nanoidCustom } from '../deps.ts'

const nanoidAlphabet = '6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz'
export const generateId = nanoidCustom(nanoidAlphabet, 20)
export const generateShortId = nanoidCustom(nanoidAlphabet, 10)
export const generateKey = nanoidCustom(nanoidAlphabet, 30)

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

export function requireEnv(name: string): string {
  const val = Deno.env.get(name)
  if (!val) {
    throw new Error(`required env variable "${name}" unset`)
  }
  return val
}

export function fromNodeStream(stream: NodeStream.Readable) {
  // The node:stream ReadableStream is missing the byob reader types so we need to cast :(
  return NodeStream.Readable.toWeb(stream) as ReadableStream
}

export function toNodeStream(stream: ReadableStream) {
  return NodeStream.Readable.fromWeb(stream as NodeStreamWeb.ReadableStream)
}
