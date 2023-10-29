import {
  $createSoundNode,
  $createSpeakerNode,
  lexicalNodes,
  $isSpeakerNode,
  $isSoundNode,
  SoundNode,
  $splitNodeShallow,
  $trimLeadingSpace,
} from '@shared/lexical'
import {
  sortBy,
  $createTextNode,
  $getRoot,
  $isTextNode,
  lexicalYjs,
  createHeadlessEditor,
  LexicalEditor,
  Y,
  LexicalNode,
  $isElementNode,
  partial,
  escapeRegExp,
} from '../deps.ts'
import { AFTER_PUNCTUATION, BEFORE_PUNCTUATION } from '@shared/constants'
import { Word } from '@shared/schema'
import { TrackInfo } from '@shared/types'

const punctuationChars = escapeRegExp(
  BEFORE_PUNCTUATION + AFTER_PUNCTUATION,
).replace('-', '\\-')
const punctuationRe = new RegExp(
  `(^[${punctuationChars}]+|[${punctuationChars}]+$)`,
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

/**
 * Get the index to insert at before/after a SoundNode, skipping to the boundary
 * before the next SoundNode.
 */
function $insertionIndex(startNode: SoundNode, insertBefore: boolean) {
  let node: LexicalNode = startNode
  let next: LexicalNode | null = insertBefore
    ? startNode.getPreviousSibling()
    : startNode.getNextSibling()
  while (next && !$isSoundNode(next)) {
    node = next
    next = insertBefore ? node.getPreviousSibling() : node.getNextSibling()
  }
  return node.getIndexWithinParent() + (insertBefore ? 0 : 1)
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
  const sortedWords = sortBy(words, 'start')
  const speakerName = trackLabel ?? 'Speaker'
  const color = trackColor ?? 'black'

  return new Promise((resolve) => {
    editor.update(
      () => {
        const root = $getRoot()
        let docNode: SoundNode | null = null

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
              newWordNode = $createSoundNode(part, {
                start: word.start,
                end: word.end,
                source: trackId,
              })
              newNodes.push(newWordNode)
            }
          }

          if (docNode === null) {
            const parentNode = $createSpeakerNode(speakerName, color, trackId)
            parentNode.append(...newNodes)
            root.append(parentNode)
          } else {
            const docNodeLocation = docNode.getSoundLocation()
            const insertBefore = docNodeLocation.start > word.start
            if (!word.isSentenceStart && docNodeLocation.source === trackId) {
              if (word.text.startsWith(' ')) {
                const spaceNode = $createTextNode(' ')
                newNodes.unshift(spaceNode)
              }
              docNode
                .getParent()!
                .splice($insertionIndex(docNode, insertBefore), 0, newNodes)
            } else {
              const parentNode = $createSpeakerNode(speakerName, color, trackId)
              parentNode.append(...newNodes)

              const docNodeParent = docNode.getParent()!
              const idx = $insertionIndex(docNode, insertBefore)

              const [beforeParent, afterParent] = $splitNodeShallow(
                docNodeParent,
                idx,
              )
              if (beforeParent === null) {
                // If the doc node is at the beginning of its parent, insert the
                // new speaker parent before.
                afterParent.insertBefore(parentNode)
              } else if (afterParent === null) {
                // Similarly, if at the end, insert the new speaker parent after.
                beforeParent.insertAfter(parentNode)
              } else {
                // Otherwise, we need to split the doc node's parent and insert
                // the new speaker parent in between.
                afterParent.insertBefore(parentNode)
                $trimLeadingSpace(afterParent)
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
