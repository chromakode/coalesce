import { $createSoundNode, lexicalNodes } from '@shared/lexical'
import type { Project, Words } from '@shared/types'
import {
  flatten,
  pick,
  sortBy,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
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

function writeProjectToEditor(
  project: Project,
  editor: LexicalEditor,
): Promise<void> {
  const allWords = sortBy(
    flatten(
      Object.values(project.tracks).map(({ words, trackId, label }) =>
        allTaggedWords(words, trackId, label ?? 'Speaker'),
      ),
    ),
    'start',
  )

  return new Promise((resolve) => {
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()

        let para = null
        let lastSource = null

        for (const word of allWords) {
          if (lastSource !== word.source) {
            para = $createParagraphNode()
            root.append(para)

            para.append($createTextNode(`${word.speakerName}: `))

            lastSource = word.source
          }

          const text = $createSoundNode(
            word.text,
            pick(word, ['source', 'start', 'end']),
          )
          para!.append(text)

          // FIXME: skip last
          para!.append($createTextNode(' '))
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

  await writeProjectToEditor(project, editor)

  removeListener()

  return doc
}
