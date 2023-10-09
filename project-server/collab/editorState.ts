import {
  $createSoundNode,
  $createSpeakerNode,
  lexicalNodes,
  $isSpeakerNode,
  $isSoundNode,
  SoundNode,
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
  LexicalNode,
  $isElementNode,
  partial,
} from '../deps.ts'
import { Word } from '@shared/schema'
import { TrackInfo } from '@shared/types'

const punctuationPattern = `[\\[\\]\\-“¿({"'.。,，!！?？:：”)}、]`
const punctuationRe = new RegExp(
  `(^${punctuationPattern}+|${punctuationPattern}+$)`,
)

// Patterned off LexicalUtils.$dfs
function* $walk(
  isForward: boolean,
  startNode: LexicalNode | null = isForward
    ? $getRoot().getFirstDescendant()
    : $getRoot().getLastDescendant(),
  skip?: (node: LexicalNode) => boolean,
): Generator<LexicalNode> {
  const end = $getRoot()
  let node: LexicalNode | null = startNode

  while (node !== null && !node.is(end)) {
    if (!skip?.(node) && $isElementNode(node) && node.getChildrenSize() > 0) {
      node = isForward ? node.getFirstDescendant() : node.getLastDescendant()
    } else {
      yield node

      // Find immediate sibling or nearest parent sibling
      let sibling = null
      while (sibling === null && node !== null) {
        sibling = isForward ? node.getNextSibling() : node.getPreviousSibling()

        if (sibling === null) {
          node = node.getParent()
          if (node !== null) {
            yield node
          }
        } else {
          node = sibling
        }
      }
    }
  }

  if (node !== null && node.is(end)) {
    yield node
  }
}

export const $walkForward = partial($walk, true)
export const $walkBackward = partial($walk, false)

function lastNonSoundNode(startNode: LexicalNode) {
  let node = startNode
  let next = startNode.getNextSibling()
  while (next && !$isSoundNode(next)) {
    node = next
    next = node.getNextSibling()
  }
  return node
}

export function addWordsToEditor({
  editor,
  trackInfo: { trackId, label: trackLabel, color: trackColor },
  words,
}: {
  editor: LexicalEditor
  trackInfo: TrackInfo
  words: Word[]
}): Promise<void> {
  const sortedWords = sortBy(
    words.map((word) => ({
      source: trackId,
      speakerName: trackLabel ?? 'Speaker',
      ...word,
    })),
    'start',
  )
  const color = trackColor ?? 'black'

  return new Promise((resolve) => {
    editor.update(
      () => {
        const root = $getRoot()
        let docNode: LexicalNode | null = null

        for (const node of $walkBackward()) {
          if (!$isSoundNode(node)) {
            continue
          }

          docNode = node

          if (node.getSoundLocation().start <= sortedWords[0].start) {
            break
          }
        }

        word: for (const word of sortedWords) {
          // TODO: should we be smarter about resolving ties so adjacent words aren't broken up?
          if (docNode !== null) {
            walk: for (const node of $walkForward(docNode)) {
              if (!$isSoundNode(node)) {
                continue walk
              }

              const docNodeLocation = node.getSoundLocation()
              if (
                docNodeLocation.start === word.start &&
                docNodeLocation.end === word.end
              ) {
                // Skip adding dupe of an existing word
                continue word
              }

              if (docNodeLocation.start > word.start) {
                break walk
              }

              docNode = node
            }
          }

          const newNodes: LexicalNode[] = []
          let newWordNode: SoundNode | undefined
          for (const part of word.text.trim().split(punctuationRe)) {
            if (!part.length) {
              continue
            }
            if (part.match(punctuationRe)) {
              newNodes.push($createTextNode(part))
            } else {
              newWordNode = $createSoundNode(
                part,
                pick(word, ['source', 'start', 'end']),
              )
              newNodes.push(newWordNode)
            }
          }

          if (docNode === null) {
            const parentNode = $createSpeakerNode(
              word.speakerName,
              color,
              word.source,
            )
            parentNode.append(...newNodes)
            root.append(parentNode)
          } else {
            const docNodeLocation = docNode.getSoundLocation()
            const insertBefore = docNodeLocation.start > word.start
            if (docNodeLocation.source === word.source) {
              if (word.text.startsWith(' ')) {
                const spaceNode = $createTextNode(' ')
                newNodes.unshift(spaceNode)
              }

              const docNodeIdx =
                lastNonSoundNode(docNode).getIndexWithinParent()
              docNode
                .getParent()!
                .splice(docNodeIdx + (insertBefore ? 0 : 1), 0, newNodes)
            } else {
              const parentNode = $createSpeakerNode(
                word.speakerName,
                color,
                word.source,
              )
              parentNode.append(...newNodes)

              const docNodeParent = docNode.getParent()!
              if (insertBefore && !docNode.getPreviousSibling()) {
                // If the doc node is at the beginning of its parent, insert the
                // new speaker parent before.
                docNodeParent.insertBefore(parentNode)
              } else if (!insertBefore && !docNode.getNextSibling()) {
                // Similarly, if at the end, insert the new speaker parent after.
                docNodeParent.insertAfter(parentNode)
              } else {
                // Otherwise, we need to split the doc node's parent and insert
                // the new speaker parent in between.
                const [_, afterParent] = $splitNode(
                  docNodeParent,
                  docNode.getIndexWithinParent() + (insertBefore ? 0 : 1),
                )
                afterParent.insertBefore(parentNode)

                // Trim leading space
                const firstAfterNode = afterParent.getFirstChild()
                if (
                  firstAfterNode &&
                  $isTextNode(firstAfterNode) &&
                  firstAfterNode.getTextContent().trim() === ''
                ) {
                  firstAfterNode.remove()
                }
              }
            }
          }

          if (newWordNode) {
            docNode = newWordNode
          }
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
        const toRemove = []
        for (const node of $walkBackward()) {
          if (!$isSpeakerNode(node)) {
            continue
          }
          if (node.getSource() === trackId) {
            toRemove.push(node)
          }
        }
        for (const node of toRemove) {
          node.remove()
        }
      },
      { onUpdate: resolve },
    )
  })
}

export function updateSpeakerInEditor({
  editor,
  trackInfo: { trackId, label: trackLabel, color: trackColor },
}: {
  editor: LexicalEditor
  trackInfo: TrackInfo
}): Promise<void> {
  return new Promise((resolve) => {
    editor.update(
      () => {
        for (const node of $walkBackward()) {
          if (!$isSpeakerNode(node)) {
            continue
          }
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
