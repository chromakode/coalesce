import type { Project } from '@shared/types'

export function emptyProject(): Project {
  return {
    projectId: '???',
    createdAt: new Date(),
    title: 'empty',
    hidden: false,
    tracks: {},
    jobs: {},
  }
}
