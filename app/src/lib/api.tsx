import { ProjectFieldsInput, TrackFieldsInput } from '@shared/schema'
import { ProjectInfo, SessionInfo } from '@shared/types'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

export const API_BASE = import.meta.env.VITE_API_BASE
export const CHUNK_GET_BASE = import.meta.env.VITE_CHUNK_GET_BASE

export class UnexpectedServerError extends Error {}
export class NeedsAuthError extends Error {}

function socketBase(): string {
  const serverURL = new URL(API_BASE)
  const socketProto = serverURL.protocol === 'https:' ? 'wss' : 'ws'
  serverURL.protocol = socketProto
  return serverURL.toString()
}

export function chunkURL(projectId: string, trackId: string, idx: number) {
  return `${CHUNK_GET_BASE}/project/${projectId}/track/${trackId}/${idx}.flac`
}

export class CoalesceAPIClient {
  guestKey?: string

  constructor({ guestKey }: { guestKey?: string } = {}) {
    this.guestKey = guestKey
  }

  get hasGuestKey() {
    return this.guestKey != null
  }

  projectSocket = (projectId: string): ReconnectingWebSocket => {
    const params = this.guestKey ? `?guestEditKey=${this.guestKey}` : ''
    return new ReconnectingWebSocket(
      `${socketBase()}/project/${projectId}/ws${params}`,
    )
  }

  collabSocketProvider = (
    roomId: string,
    doc: Y.Doc,
    options: ConstructorParameters<typeof WebsocketProvider>[3],
  ) => {
    return new WebsocketProvider(`${socketBase()}/project/`, roomId, doc, {
      ...options,
      params: this.guestKey ? { guestEditKey: this.guestKey } : undefined,
    })
  }

  fetch = async (input: RequestInfo, init?: RequestInit) => {
    const resp = await fetch(input, {
      credentials: 'include',
      ...init,
      headers: this.guestKey
        ? {
            ...init?.headers,
            authorization: `Bearer ${this.guestKey}`,
          }
        : init?.headers,
    })

    if (resp.status === 401) {
      throw new NeedsAuthError()
    }
    if (!resp.ok) {
      throw new UnexpectedServerError('Failed to fetch session')
    }
    return resp
  }

  fetchJSON = async (input: RequestInfo, init?: RequestInit) => {
    const resp = await this.fetch(input, init)
    return await resp.json()
  }

  getSession = (): Promise<SessionInfo> => {
    return this.fetchJSON(`${API_BASE}/session`)
  }

  listProjects = (): Promise<ProjectInfo[]> => {
    return this.fetchJSON(`${API_BASE}/project/`)
  }

  createProject = (params: ProjectFieldsInput = {}): Promise<ProjectInfo> => {
    return this.fetchJSON(`${API_BASE}/project/`, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  uploadTrack = (
    projectId: string,
    file: File,
    onProgress: (progress: number) => void,
  ): { result: Promise<{ trackId: string }>; abort: () => void } => {
    const xhr = new XMLHttpRequest()
    const abort = xhr.abort.bind(xhr)
    return {
      result: new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (ev) => {
          if (!ev.lengthComputable) {
            return
          }
          onProgress(ev.loaded / ev.total)
        })
        xhr.addEventListener('loadend', () => {
          if (xhr.readyState === 4 && xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText))
          } else {
            reject(xhr)
          }
        })
        xhr.open(
          'POST',
          `${API_BASE}/project/${projectId}/track?filename=${file.name}`,
          true,
        )
        xhr.setRequestHeader('Content-Type', file.type)
        if (this.guestKey) {
          xhr.setRequestHeader('Authorization', `Bearer ${this.guestKey}`)
        }
        xhr.send(file)
      }),
      abort,
    }
  }

  updateProject = (
    projectId: string,
    params: ProjectFieldsInput,
  ): Promise<void> => {
    return this.fetchJSON(`${API_BASE}/project/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  updateTrack = (
    projectId: string,
    trackId: string,
    params: TrackFieldsInput,
  ): Promise<void> => {
    return this.fetchJSON(`${API_BASE}/project/${projectId}/track/${trackId}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  deleteTrack = (projectId: string, trackId: string): Promise<void> => {
    return this.fetchJSON(`${API_BASE}/project/${projectId}/track/${trackId}`, {
      method: 'DELETE',
    })
  }
}
