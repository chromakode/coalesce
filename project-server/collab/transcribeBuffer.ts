import { LexicalEditor, maxBy, minBy, partition } from '../deps.ts'
import { Segment, Word } from '@shared/schema'
import { getBatchTrackInfo } from '../lib/queries.ts'
import { addWordsToEditor } from './editorState.ts'

interface TranscribeCursor {
  words: Word[]
  time: number
}

/**
 * Buffers incoming transcribed words for the tracks of a project, keeping track
 * of the point in time that all transcribes have caught up to. Adds words to
 * the document as this point of time moves forward.
 */
export class TranscribeBuffer {
  projectId: string
  editor: LexicalEditor
  trackCursors = new Map<string, TranscribeCursor>()

  constructor(projectId: string, editor: LexicalEditor) {
    this.projectId = projectId
    this.editor = editor
  }

  _getCursor(trackId: string) {
    let cursor = this.trackCursors.get(trackId)
    if (!cursor) {
      cursor = {
        words: [],
        time: 0,
      }
      this.trackCursors.set(trackId, cursor)
    }
    return cursor
  }

  async flushBuffer() {
    const wordsToAdd = new Map<string, Word[]>()

    const earliestTime =
      minBy([...this.trackCursors.values()], 'time')?.time ?? 0

    for (const [trackId, cursor] of this.trackCursors.entries()) {
      const [toAdd, queued] = partition(
        cursor.words,
        (s) => s.start <= earliestTime,
      )
      if (toAdd.length) {
        wordsToAdd.set(trackId, toAdd)
        cursor.words = queued
      }
    }

    if (!wordsToAdd.size) {
      return
    }

    const trackInfos = await getBatchTrackInfo(this.projectId, [
      ...wordsToAdd.keys(),
    ])

    for (const [trackId, words] of wordsToAdd.entries()) {
      await addWordsToEditor({
        editor: this.editor,
        trackInfo: trackInfos[trackId],
        words,
      })
    }
  }

  async handleTrackStatus({
    trackId,
    status,
  }: {
    trackId: string
    status: 'running' | 'complete' | 'failed'
  }) {
    const cursor = this._getCursor(trackId)

    if (status === 'complete' || status === 'failed') {
      cursor.time = Infinity
    }

    await this.flushBuffer()
  }

  async handleTrackWords({
    trackId,
    segments,
  }: {
    trackId: string
    segments: Segment[]
  }) {
    const cursor = this._getCursor(trackId)

    for (const segment of segments) {
      cursor.words.push(...segment.words)
      cursor.time = Math.max(
        cursor.time,
        maxBy(segment.words, (s) => s.start)?.start ?? 0,
      )
    }

    await this.flushBuffer()
  }
}
