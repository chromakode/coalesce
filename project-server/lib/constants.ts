import { path } from '../deps.ts'

export const storePath = {
  projectDocPath: (projectId: string, versionId: string) =>
    path.join('project', projectId, 'doc', versionId),
  trackUploadPath: (trackId: string) => path.join('track', trackId, 'upload'),
  trackDir: (trackId: string) => path.join('track', trackId) + '/',
  trackWords: (trackId: string) => path.join('track', trackId, 'words.json'),
  trackChunkFile: (trackId: string, chunkName: string) =>
    path.join('track', trackId, chunkName),
}
