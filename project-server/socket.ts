import { Buffer as NodeBuffer } from 'node:buffer'
import {
  debounce,
  pThrottle,
  Y,
  awarenessProtocol,
  syncProtocol,
  lib0,
  EventIterator,
  abortableSource,
} from './deps.ts'
import {
  generateCollabDoc,
  getAwarenessData,
  getCollabDoc,
  getProjectState,
  publishProjectCollab,
  saveCollabDoc,
  watchProject,
  watchProjectCollab,
} from './store.ts'

const { encoding, decoding } = lib0

enum msgType {
  Sync = 0,
  Awareness = 1,
}

function iterSocket(ws: WebSocket) {
  return new EventIterator<MessageEvent>((queue) => {
    ws.onmessage = queue.push
    ws.onclose = queue.stop
    ws.onerror = () => queue.fail(new Error('WebSocket error'))
    return () => {
      ws.close()
    }
  })
}

function cancelable<T>(
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

export async function runCollab(projectId: string, ws: WebSocket) {
  const doc = new Y.Doc({ gc: true })
  const awareness = new awarenessProtocol.Awareness(doc)

  async function sendEncoded(
    send: (data: Uint8Array) => Promise<void>,
    cb: (enc: lib0.encoding.Encoder) => boolean | undefined | void,
  ) {
    const encoder = encoding.createEncoder()
    if (cb(encoder) === false) {
      return
    }
    await send(encoding.toUint8Array(encoder))
  }

  // https://github.com/denoland/deno/issues/19851
  const denoSocketThrottle = pThrottle({ limit: 1, interval: 0 })

  const toWS = denoSocketThrottle(async (data: Uint8Array) => {
    if (ws.readyState !== ws.OPEN) {
      return
    }
    // Work around Deno buffering issue
    while (ws.bufferedAmount) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    try {
      ws.send(data)
    } catch (err) {
      console.warn('failed to send', err)
      // TODO: send error handling
    }
  })

  async function toPeers(data: Uint8Array) {
    return await publishProjectCollab(projectId, awareness.clientID, data)
  }

  function saveDoc() {
    saveCollabDoc(projectId, Y.encodeStateAsUpdate(doc))
  }

  // TODO: reduce interval based on # of connected clients, smarter promise
  // debounce in case of long save wait times
  const queueSaveDoc = debounce(saveDoc, 10 * 1000)

  // When awareness state changes, send update to the client
  function handleAwarenessChange(
    {
      added,
      updated,
      removed,
    }: {
      added: Array<number>
      updated: Array<number>
      removed: Array<number>
    },
    transactionOrigin: WebSocket | undefined,
  ) {
    if (transactionOrigin === ws) {
      return
    }
    const changedClients = added.concat(updated, removed)
    sendEncoded(toWS, (enc) => {
      encoding.writeVarUint(enc, msgType.Awareness)
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
      )
    })
  }

  // When the doc changes, send update to the client
  function handleDocUpdate(
    update: Uint8Array,
    transactionOrigin: WebSocket | undefined,
  ) {
    queueSaveDoc()
    if (transactionOrigin === ws) {
      return
    }
    sendEncoded(toWS, (enc) => {
      encoding.writeVarUint(enc, msgType.Sync)
      syncProtocol.writeUpdate(enc, update)
    })
  }

  // Messages from clientSocket
  async function handleReceiveFromClient(ev: MessageEvent) {
    if (!(ev.data instanceof ArrayBuffer)) {
      return
    }

    const msg = new Uint8Array(ev.data)
    const decoder = decoding.createDecoder(msg)
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case msgType.Sync:
        await sendEncoded(toWS, (enc) => {
          encoding.writeVarUint(enc, msgType.Sync)
          syncProtocol.readSyncMessage(decoder, enc, doc, ws)
          // If the `encoder` only contains the type of reply message and no
          // message, there is no need to send the message. When `encoder` only
          // contains the type of reply, its length is 1.
          if (encoding.length(enc) <= 1) {
            return false
          }
        })
        break
      case msgType.Awareness:
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        )
        break
    }

    // Propagate to peers
    toPeers(msg)
  }

  // Messages from other server instances via redis pubsub
  async function handleReceiveFromPeer(msg: NodeBuffer) {
    const decoder = decoding.createDecoder(msg)
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case msgType.Sync:
        await sendEncoded(toPeers, (enc) => {
          encoding.writeVarUint(enc, msgType.Sync)
          syncProtocol.readSyncMessage(decoder, enc, doc, ws)
          if (encoding.length(enc) <= 1) {
            return false
          }
        })
        break
      case msgType.Awareness:
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        )
        break
    }
  }

  async function sendInitToClient() {
    await sendEncoded(toWS, (enc) => {
      encoding.writeVarUint(enc, msgType.Sync)
      syncProtocol.writeSyncStep1(enc, doc)
    })

    const awarenessStates = awareness.getStates()
    if (awarenessStates.size > 0) {
      await sendEncoded(toWS, (enc) => {
        encoding.writeVarUint(enc, msgType.Awareness)
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(awareness, [
            ...awarenessStates.keys(),
          ]),
        )
      })
    }
  }

  ws.binaryType = 'arraybuffer'

  // Start queueing messages immediately while we load the doc
  const clientMessages = iterSocket(ws)

  const [awarenessData, storedDoc] = await Promise.all([
    getAwarenessData(projectId),
    getCollabDoc(projectId),
  ])

  const docData = storedDoc ?? (await generateCollabDoc(projectId))
  Y.applyUpdate(doc, docData)
  if (!storedDoc) {
    saveDoc()
  }

  awareness.setLocalState(null)
  if (awarenessData != null) {
    awarenessProtocol.applyAwarenessUpdate(awareness, awarenessData, null)
  }

  await sendInitToClient()

  doc.on('update', handleDocUpdate)
  awareness.on('update', handleAwarenessChange)

  const stopWatchingPeers = cancelable(
    watchProjectCollab(projectId, awareness.clientID),
    handleReceiveFromPeer,
  )

  try {
    for await (const ev of clientMessages) {
      handleReceiveFromClient(ev)
    }
  } finally {
    stopWatchingPeers()
    queueSaveDoc.flush()
  }
}

export async function pushProjectUpdates(projectId: string, ws: WebSocket) {
  const projectState = await getProjectState(projectId)
  ws.send(JSON.stringify({ type: 'project:data', data: projectState }))

  for await (const message of watchProject(projectId)) {
    ws.send(message)
  }
}
