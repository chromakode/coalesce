import {
  $createSoundNode,
  SoundNode,
  $createSpeakerNode,
  SpeakerNode,
  lexicalNodes,
  $nodesOfTypeInOrder,
} from '@shared/lexical'
import {
  pick,
  sortBy,
  $createTextNode,
  $getRoot,
  $splitNode,
  $isTextNode,
  lexicalYjs,
  createHeadlessEditor,
  LexicalEditor,
  Y,
} from '../deps.ts'
import { Segment } from '@shared/schema'

function allTaggedWords(
  segments: Segment[],
  source: string,
  speakerName: string,
) {
  const result = []
  for (const segment of segments) {
    for (const word of segment.words) {
      result.push({ source, speakerName, ...word })
    }
  }
  return result
}

export function addWordsToEditor({
  editor,
  trackId,
  trackLabel,
  trackColor,
  segments,
}: {
  editor: LexicalEditor
  trackId: string
  trackLabel?: string
  trackColor?: string
  segments: Segment[]
}): Promise<void> {
  const sortedWords = sortBy(
    allTaggedWords(segments, trackId, trackLabel ?? 'Speaker'),
    'start',
  )
  const color = trackColor ?? 'black'

  return new Promise((resolve) => {
    editor.update(
      () => {
        const root = $getRoot()
        const soundNodes = $nodesOfTypeInOrder(SoundNode)

        let prevWordNode: SoundNode = soundNodes[0]
        wordLoop: for (const word of sortedWords) {
          // TODO: should we be smarter about resolving ties so adjacent words aren't broken up?
          while (
            soundNodes.length &&
            soundNodes[0].getSoundLocation().start <= word.start
          ) {
            prevWordNode = soundNodes.shift()!

            const prevWordLocation = prevWordNode.getSoundLocation()
            if (
              prevWordLocation.start === word.start &&
              prevWordLocation.end === word.end
            ) {
              // Skip adding dupe of an existing word
              continue wordLoop
            }
          }

          const newWordNode = $createSoundNode(
            word.text.trim(),
            pick(word, ['source', 'start', 'end']),
          )

          if (prevWordNode === undefined) {
            const parentNode = $createSpeakerNode(
              word.speakerName,
              color,
              word.source,
            )
            parentNode.append(newWordNode)
            root.append(parentNode)
          } else if (prevWordNode.getSoundLocation().source === word.source) {
            const spaceNode = $createTextNode(' ')
            prevWordNode.insertAfter(spaceNode)
            spaceNode.insertAfter(newWordNode)
          } else {
            const [beforeParent, afterParent] = $splitNode(
              prevWordNode.getParent()!,
              prevWordNode.getIndexWithinParent(),
            )

            const parentNode = $createSpeakerNode(
              word.speakerName,
              color,
              word.source,
            )
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

export function removeTrackFromEditor({
  editor,
  trackId,
}: {
  trackId: string
  editor: LexicalEditor
}): Promise<void> {
  return new Promise((resolve) => {
    editor.update(
      () => {
        const speakerNodes = $nodesOfTypeInOrder(SpeakerNode)
        for (const node of speakerNodes) {
          if (node.getSource() === trackId) {
            node.remove()
          }
        }
      },
      { onUpdate: resolve },
    )
  })
}

export function updateSpeakerInEditor({
  editor,
  trackId,
  trackLabel,
  trackColor,
}: {
  editor: LexicalEditor
  trackId: string
  trackLabel?: string
  trackColor?: string
}): Promise<void> {
  return new Promise((resolve) => {
    editor.update(
      () => {
        const speakerNodes = $nodesOfTypeInOrder(SpeakerNode)
        for (const node of speakerNodes) {
          if (node.getSource() === trackId) {
            node.setLabel(trackLabel ?? 'Speaker', trackColor ?? 'black')
          }
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
export function editCollabDoc(
  projectId: string,
  doc: Y.Doc,
): { editor: LexicalEditor; dispose: () => void } {
  const editor: LexicalEditor = createHeadlessEditor({
    namespace: 'coalesce',
    nodes: lexicalNodes,
    // deno-lint-ignore no-explicit-any
    onError: (error: any) => {
      console.error('lexical headless error:', error)
    },
  })

  const docId = `${projectId}/collab`
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

  // Unclear why this is necessary (see linked lexical discussion above)
  editor.update(() => {}, { discrete: true })

  function dispose() {
    removeListener()
  }

  return { editor, dispose }
}
