import {
  $createSoundNode,
  SoundNode,
  $createSpeakerNode,
  SpeakerNode,
  lexicalNodes,
} from '@shared/lexical'
import type { Project, Track, Words } from '@shared/types'
import {
  pick,
  sortBy,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  $splitNode,
  $isTextNode,
  lexicalYjs,
  createHeadlessEditor,
  LexicalEditor,
  Y,
} from './deps.ts'

function allTaggedWords(words: Words, source: string, speakerName: string) {
  const result = []
  for (const segment of words.segments) {
    for (const word of segment.words) {
      result.push({ source, speakerName, ...word })
    }
  }
  return result
}

function addTrackToEditor(track: Track, editor: LexicalEditor): Promise<void> {
  const words = sortBy(
    allTaggedWords(track.words, track.trackId, track.label ?? 'Speaker'),
    'start',
  )

  return new Promise((resolve) => {
    editor.update(
      () => {
        const root = $getRoot()
        const soundNodes = $nodesOfType(SoundNode)

        let prevWordNode: SoundNode = soundNodes[0]
        for (const word of words) {
          // TODO: should we be smarter about resolving ties so adjacent words aren't broken up?
          while (
            soundNodes.length &&
            soundNodes[0].getSoundLocation().start <= word.start
          ) {
            prevWordNode = soundNodes.shift()!
          }

          const newWordNode = $createSoundNode(
            word.text,
            pick(word, ['source', 'start', 'end']),
          )

          if (prevWordNode === undefined) {
            const parentNode = $createSpeakerNode(word.speakerName, word.source)
            parentNode.append(newWordNode)
            root.append(parentNode)
          } else if (
            prevWordNode.getSoundLocation().source === word.source ||
            prevWordNode === prevWordNode.getParent()?.getLastChild()
          ) {
            const spaceNode = $createTextNode(' ')
            prevWordNode.insertAfter(spaceNode)
            spaceNode.insertAfter(newWordNode)
          } else {
            const [beforeParent, afterParent] = $splitNode(
              prevWordNode.getParent()!,
              prevWordNode.getIndexWithinParent(),
            )

            const parentNode = $createSpeakerNode(word.speakerName, word.source)
            afterParent.insertBefore(parentNode)
            parentNode.append(newWordNode)

            // Trim leading space
            const firstAfterNode = afterParent.getFirstChild()
            if (
              firstAfterNode &&
              $isTextNode(firstAfterNode) &&
              firstAfterNode.getTextContent().trim() === ''
            ) {
              firstAfterNode.remove()
            }

            if (
              beforeParent &&
              beforeParent.getTextContent().trim().length === 0
            ) {
              beforeParent.remove()
            }
          }

          prevWordNode = newWordNode
        }
      },
      { onUpdate: resolve },
    )
  })
}

function dummyProvider(): lexicalYjs.Provider {
  return {
    awareness: {
      getLocalState: () => null,
      setLocalState: () => null,
      getStates: () => new Map(),
      on: () => null,
      off: () => null,
    },
    connect: () => {},
    disconnect: () => null,
    on: () => null,
    off: () => null,
  }
}

// Thanks to https://github.com/facebook/lexical/discussions/4442#discussioncomment-5785644 for providing an example of this.
export async function projectToYDoc(
  project: Project,
  baseDoc?: Uint8Array,
): Promise<Y.Doc> {
  const editor = createHeadlessEditor({
    namespace: 'coalesce',
    nodes: lexicalNodes,
    // deno-lint-ignore no-explicit-any
    onError: (error: any) => {
      console.error('lexical headless error:', error)
    },
  })

  const doc = new Y.Doc()
  const docId = `${project.projectId}/collab`
  const provider = dummyProvider()
  const binding = lexicalYjs.createBinding(
    editor,
    provider,
    docId,
    doc,
    new Map([[docId, doc]]),
  )

  const removeListener = editor.registerUpdateListener(
    ({
      prevEditorState,
      editorState,
      dirtyLeaves,
      dirtyElements,
      normalizedNodes,
      tags,
    }) => {
      if (tags.has('skip-collab') === false) {
        lexicalYjs.syncLexicalUpdateToYjs(
          binding,
          provider,
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        )
      }
    },
  )

  binding.root.getSharedType().observeDeep((events, transaction) => {
    if (transaction?.origin !== binding) {
      lexicalYjs.syncYjsChangesToLexical(binding, provider, events, false)
    }
  })

  if (baseDoc) {
    Y.applyUpdate(binding.doc, baseDoc)
  }

  // Unclear why this is necessary (see linked lexical discussion above)
  editor.update(() => {}, { discrete: true })

  for (const track of Object.values(project.tracks)) {
    await addTrackToEditor(track, editor)
  }

  removeListener()

  return doc
}
