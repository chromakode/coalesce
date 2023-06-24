import { ProjectParamsInput, TrackParamsInput } from '@shared/schema'
import { ProjectInfo } from '@shared/types'
import { join } from 'path-browserify'
import ReconnectingWebSocket from 'reconnecting-websocket'

export const server = import.meta.env.VITE_PROJECT_SERVER

export function projectSocket(projectId: string): ReconnectingWebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return new ReconnectingWebSocket(
    `${proto}://${server}/project/${projectId}/ws`,
  )
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const resp = await fetch(`//${server}/project/`)
  return await resp.json()
}

export async function createProject(
  params: ProjectParamsInput = {},
): Promise<ProjectInfo> {
  const resp = await fetch(`//${server}/project/`, {
    method: 'POST',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
  })
  return await resp.json()
}

export function uploadTrack(
  projectId: string,
  file: File,
  onProgress: (progress: number) => void,
): { result: Promise<{ id: string }>; abort: () => void } {
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
      xhr.open('POST', `//${server}/project/${projectId}/track`, true)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.send(file)
    }),
    abort,
  }
}

export async function updateProject(
  projectId: string,
  params: ProjectParamsInput,
): Promise<void> {
  await fetch(`//${server}/project/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function updateTrack(
  projectId: string,
  trackId: string,
  params: TrackParamsInput,
): Promise<void> {
  await fetch(`//${server}/project/${projectId}/track/${trackId}`, {
    method: 'PUT',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function deleteTrack(
  projectId: string,
  trackId: string,
): Promise<void> {
  await fetch(`//${server}/project/${projectId}/track/${trackId}`, {
    method: 'DELETE',
  })
}

export function chunkURL(
  projectId: string,
  trackId: string,
  chunkName: string,
) {
  return (
    `//${server}/` +
    join('project', projectId, 'track', trackId, chunkName)
  )
}
