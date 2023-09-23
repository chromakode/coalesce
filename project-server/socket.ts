import {
  debounce,
  castArray,
  Y,
  awarenessProtocol,
  syncProtocol,
  lib0,
} from './deps.ts'
import {
  getAwarenessData,
  coalesceCollabDoc,
  getProjectState,
  publishProjectCollab,
  saveCollabDoc,
  watchProject,
  watchProjectCollab,
  saveAwarenessData,
} from './store/index.ts'
import { iterSocket, cancelable } from './utils.ts'

const { encoding, decoding } = lib0

enum msgType {
  Sync = 0,
  Awareness = 1,
}

type TransactionOrigin = 'local' | 'peer' | 'client' | undefined

type SendSink = (data: Uint8Array) => void | Promise<void>

export async function runCollab(projectId: string, ws: WebSocket) {
  const doc = new Y.Doc({ gc: true })
  const awareness = new awarenessProtocol.Awareness(doc)

  async function sendEncoded(
    sinks: SendSink | SendSink[],
    cb: (enc: lib0.encoding.Encoder) => boolean | undefined | void,
  ) {
    const encoder = encoding.createEncoder()
    if (cb(encoder) === false) {
      return
    }

    const data = encoding.toUint8Array(encoder)
    for (const send of castArray(sinks)) {
      await send(data)
    }
  }

  const toWS: SendSink = (data: Uint8Array) => {
    if (ws.readyState !== ws.OPEN) {
      return
    }
    try {
      ws.send(data)
    } catch (err) {
      console.warn('failed to send', err)
      // TODO: send error handling
    }
  }

  const toPeers: SendSink = async (data: Uint8Array) =>
    await publishProjectCollab(projectId, awareness.clientID, data)

  function saveDoc() {
    saveCollabDoc(projectId, Y.encodeStateAsUpdate(doc))
  }

  function saveAwareness() {
    saveAwarenessData(
      projectId,
      awarenessProtocol.encodeAwarenessUpdate(awareness, [
        ...awareness.getStates().keys(),
      ]),
    )
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
    transactionOrigin: TransactionOrigin,
  ) {
    // Awareness updates can come from the client (websocket) or peers (redis)
    // Save awareness updates from our client or our local timer.
    if (transactionOrigin === 'client') {
      saveAwareness()
    }

    const sinks = []
    if (transactionOrigin !== 'client') {
      sinks.push(toWS)
    }
    if (transactionOrigin !== 'peer') {
      sinks.push(toPeers)
    }

    const changedClients = added.concat(updated, removed)
    sendEncoded(sinks, (enc) => {
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
    transactionOrigin: TransactionOrigin,
  ) {
    queueSaveDoc()
    if (transactionOrigin === 'client') {
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
          syncProtocol.readSyncMessage(decoder, enc, doc, 'client')
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
          'client',
        )
        break
    }

    // Propagate to peers
    toPeers(msg)
  }

  // Messages from other server instances via redis pubsub
  async function handleReceiveFromPeer(msg: Uint8Array) {
    const decoder = decoding.createDecoder(msg)
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case msgType.Sync:
        await sendEncoded(toPeers, (enc) => {
          encoding.writeVarUint(enc, msgType.Sync)
          syncProtocol.readSyncMessage(decoder, enc, doc, 'peer')
          if (encoding.length(enc) <= 1) {
            return false
          }
        })
        break
      case msgType.Awareness:
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          'peer',
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
    coalesceCollabDoc(projectId),
  ])

  if (storedDoc) {
    Y.applyUpdate(doc, storedDoc)
  }

  awareness.setLocalState(null)
  if (awarenessData != null) {
    awarenessProtocol.applyAwarenessUpdate(awareness, awarenessData, 'peer')
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
    awareness.destroy()
    doc.destroy()
  }
}

export async function pushProjectUpdates(projectId: string, ws: WebSocket) {
  const projectState = await getProjectState(projectId)
  ws.send(JSON.stringify({ type: 'project:data', data: projectState }))

  for await (const message of watchProject(projectId)) {
    ws.send(message)
  }
}

export async function sendDocUpdate(projectId: string, update: Uint8Array) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, msgType.Sync)
  syncProtocol.writeUpdate(encoder, update)
  const data = encoding.toUint8Array(encoder)
  await publishProjectCollab(projectId, 'coalesce', data)
}
