import type { Project } from '@shared/types'
import { SerializedEditorState } from 'lexical'
import localForage from 'localforage'

export function emptyProject(): Project {
  return {
    id: '???',
    title: 'empty',
    slug: 'empty',
    hidden: false,
    tracks: {},
    jobs: {},
  }
}

function storageKey(projectId: string) {
  return `${projectId}:editorState`
}

export async function loadProjectEditorState(
  projectId: string,
): Promise<SerializedEditorState | null> {
  const key = storageKey(projectId)
  const data: any = await localForage.getItem(key)
  return (data as SerializedEditorState) ?? null
}

export async function saveProjectEditorState(
  projectId: string,
  editorState: SerializedEditorState,
) {
  const key = storageKey(projectId)
  localForage.setItem(key, editorState)
}
