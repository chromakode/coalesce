import {
  castArray,
  Y,
  awarenessProtocol,
  syncProtocol,
  lib0,
  LexicalEditor,
  EventIterator,
} from '../deps.ts'
import {
  getAwarenessData,
  coalesceCollabDoc,
  saveAwarenessData,
} from './store.ts'
import { editCollabDoc } from './editorState.ts'
import { TranscribeBuffer } from './transcribeBuffer.ts'

const { encoding, decoding } = lib0

export const COLLAB_DISPOSE_TTL_MS = 10 * 60 * 1000
export const COLLAB_SAVE_INTERVAL_MS = 30 * 1000

enum msgType {
  Sync = 0,
  Awareness = 1,
}
type TransactionOrigin = WebSocket | undefined
type SendSink = (data: Uint8Array) => void | Promise<void>

const liveCollabs = new Map<string, Promise<CollabProvider>>()

/**
 * Get a live collab project, or create if not running.
 */
export function getCollab(projectId: string) {
  async function loadCollab() {
    const collab = new CollabProvider(projectId)
    await collab.load()
    return collab
  }

  let collab = liveCollabs.get(projectId)
  if (!collab) {
    collab = loadCollab()
    liveCollabs.set(projectId, collab)
  }
  return collab
}

Deno.addSignalListener('SIGTERM', async () => {
  console.log('Saving live collabs before exiting...')
  for (const collabPromise of liveCollabs.values()) {
    const collab = await collabPromise
    await collab.dispose()
  }
  console.log('Saved.')
  Deno.exit()
})

class CollabProvider {
  projectId: string
  doc = new Y.Doc({ gc: true })
  lastDocState: Uint8Array | undefined
  awareness = new awarenessProtocol.Awareness(this.doc)

  _editor: LexicalEditor | undefined
  _transcribeBuffer: TranscribeBuffer | undefined
  _disposeEditor: (() => void) | undefined

  disposed = false
  connectedSockets = 0
  _saveTimeout: number | undefined
  _disposeTimeout: number | undefined

  constructor(projectId: string) {
    this.projectId = projectId
  }

  async load() {
    const title = `Fetched project ${this.projectId}`
    console.time(title)
    const [awarenessData, storedDoc] = await Promise.all([
      getAwarenessData(this.projectId),
      coalesceCollabDoc(this.projectId),
    ])
    console.timeEnd(title)

    const { editor, dispose } = editCollabDoc(this.projectId, this.doc)
    this._editor = editor
    this._disposeEditor = dispose

    if (storedDoc) {
      try {
        Y.applyUpdateV2(this.doc, storedDoc)
      } catch (err) {
        // TODO remove after projects migrated
        console.warn('Error loading doc', err)
        Y.applyUpdate(this.doc, storedDoc)
      }
      this.lastDocState = Y.encodeStateVector(this.doc)
    }

    this.awareness.setLocalState(null)
    if (awarenessData != null) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        awarenessData,
        undefined,
      )
    }

    this.doc.on('update', () => {
      this.queueSave()
    })

    console.log('Loaded project', this.projectId)
  }

  queueSave() {
    if (this._saveTimeout) {
      return
    }
    this._saveTimeout = setTimeout(async () => {
      await this.saveDoc()
      this._saveTimeout = undefined
    }, COLLAB_SAVE_INTERVAL_MS)
  }

  async saveAwareness() {
    await saveAwarenessData(
      this.projectId,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        ...this.awareness.getStates().keys(),
      ]),
    )
  }

  async saveDoc() {
    const title = `Saved project ${this.projectId}`
    console.time(title)
    const stateVector = Y.encodeStateVector(this.doc)
    const update = Y.encodeStateAsUpdateV2(this.doc, this.lastDocState)
    await coalesceCollabDoc(this.projectId, update)
    this.lastDocState = stateVector
    console.timeEnd(title)
  }

  queueDispose() {
    if (this.connectedSockets > 0) {
      return
    }
    this._disposeTimeout = setTimeout(() => {
      this.dispose()
    }, COLLAB_DISPOSE_TTL_MS)
  }

  async dispose() {
    this.disposed = true

    this._disposeEditor?.()

    await this.saveAwareness()
    await this.saveDoc()

    this.awareness.destroy()
    this.doc.destroy()

    liveCollabs.delete(this.projectId)

    console.log('Disposed project', this.projectId)
  }

  getEditor() {
    if (this.disposed) {
      throw new Error('getEditor on disposed Collab')
    }
    if (!this._editor) {
      throw new Error('getEditor on non-loaded Collab')
    }
    return this._editor
  }

  getTranscribeBuffer() {
    if (!this._transcribeBuffer) {
      const editor = this.getEditor()
      this._transcribeBuffer = new TranscribeBuffer(this.projectId, editor)
    }
    return this._transcribeBuffer
  }

  async runCollabSocket(
    ws: WebSocket,
    incomingMessages: EventIterator<MessageEvent>,
  ) {
    if (this.disposed) {
      throw new Error('runCollabSocket on disposed Collab')
    }

    const { doc, awareness } = this

    clearTimeout(this._disposeTimeout)
    this.connectedSockets++

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
      if (transactionOrigin === ws) {
        // Don't echo updates back to clients
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
      transactionOrigin: TransactionOrigin,
    ) {
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

    try {
      await sendInitToClient()

      doc.on('update', handleDocUpdate)
      awareness.on('update', handleAwarenessChange)

      for await (const ev of incomingMessages) {
        handleReceiveFromClient(ev)
      }
    } finally {
      this.connectedSockets--
      this.queueDispose()
    }
  }
}
