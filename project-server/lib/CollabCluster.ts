import { isIP } from 'node:net'
import { EventEmitter } from 'node:events'
import {
  CreateTRPCProxyClient,
  HashRing,
  LRUCache,
  createTRPCProxyClient,
  httpBatchLink,
  invariant,
  isEqual,
} from '../deps.ts'
import { CollabRPCRouter } from '../collab/rpc.ts'

const MAX_RPC_INSTANCES = 128

export class CollabCluster {
  endpoint: string
  events = new EventEmitter()
  nodes: string[] = []
  ring = new HashRing()

  _rpcCache = new LRUCache<
    string,
    { node: string; rpc: CreateTRPCProxyClient<CollabRPCRouter> }
  >({
    max: MAX_RPC_INSTANCES,
  })
  _refreshInterval: number | undefined

  constructor(endpoint: string, refreshIntervalMS = 2000) {
    this.endpoint = endpoint
    const hostname = new URL(endpoint).hostname

    if (isIP(hostname) || hostname === 'localhost') {
      this.ring.addNode(hostname)
      return
    }

    this._refreshInterval = setInterval(this.refresh, refreshIntervalMS)
    this.refresh()
  }

  refresh = async () => {
    const hostname = new URL(this.endpoint).hostname
    const nodes = await Deno.resolveDns(hostname, 'A')
    if (isEqual(nodes, this.nodes)) {
      return
    }

    this.ring = new HashRing(nodes)
    this.events.emit('update')
  }

  socket(projectId: string) {
    const node = this.ring.getNode(projectId)
    invariant(node !== undefined)

    const url = new URL(this.endpoint)
    url.hostname = node
    url.protocol = 'ws'
    url.pathname = `/project/${projectId}/ws`
    const socket = new WebSocket(url.toString())

    // If the ring destination changes, disconnect the socket so the client reconnects.
    const checkUpdate = () => {
      const newNode = this.ring.getNode(projectId)
      if (newNode !== node) {
        console.debug(
          'Collab endpoint changed:',
          projectId,
          node,
          '->',
          newNode,
          '(closing socket)',
        )
        socket.close()
      }
    }
    this.events.on('update', checkUpdate)

    socket.addEventListener('close', () => {
      this.events.off('update', checkUpdate)
    })

    return socket
  }

  rpc(projectId: string) {
    const node = this.ring.getNode(projectId)
    invariant(node !== undefined)

    const cacheResult = this._rpcCache.get(projectId)
    if (cacheResult) {
      if (cacheResult.node === node) {
        return cacheResult.rpc
      } else {
        console.debug(
          'Collab endpoint changed:',
          projectId,
          cacheResult.node,
          '->',
          node,
          '(recreating RPC)',
        )
      }
    }

    const url = new URL(this.endpoint)
    url.hostname = node
    url.pathname = `/project/${projectId}/trpc`
    const rpc = createTRPCProxyClient<CollabRPCRouter>({
      links: [
        httpBatchLink({
          url: url.toString(),
        }),
      ],
    })
    this._rpcCache.set(projectId, { node, rpc })
    return rpc
  }
}
