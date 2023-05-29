import { Container } from '@chakra-ui/react'
import { HEADING } from '@lexical/markdown'
import {
  InitialConfigType,
  LexicalComposer,
} from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { HeadingNode } from '@lexical/rich-text'
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  EditorState,
  LexicalEditor,
} from 'lexical'
import { debounce, mapValues } from 'lodash-es'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  getEndTime,
  OffsetSoundLocation,
  processLocations,
  SoundLocation,
} from './audio'
import { Project } from './project'
import { $isSoundNode, SoundNode } from './SoundNode'
import { initialEditorState } from './words'

function onError(error: Error) {
  console.error(error)
}

function RefPlugin({ editorRef }: { editorRef: any }) {
  const [editor] = useLexicalComposerContext()
  editorRef.current = editor
  return null
}

export type SoundNodeData = ReturnType<SoundNode['exportJSON']> & {
  key: string
}

export interface EditorRef {
  getEditor: () => LexicalEditor | null
  updateSoundNode: (key: string, loc: Partial<SoundLocation>) => void
  getAllSoundLocations: () => OffsetSoundLocation[]
}

export interface EditorMetrics {
  durationMS: number
}

export interface EditorProps {
  project: Project
  onSelect?: (locs: OffsetSoundLocation[], nodes: SoundNodeData[]) => void
  onMetricsUpdated?: (metrics: EditorMetrics) => void
}

export const Editor = forwardRef<EditorRef, EditorProps>(function Editor(
  { project, onSelect, onMetricsUpdated },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null)

  const initialConfig: InitialConfigType = {
    namespace: 'Coalesce',
    theme: {
      ltr: 'ltr',
      rtl: 'rtl',
      placeholder: 'editor-placeholder',
      paragraph: 'editor-paragraph',
      sourceColors: mapValues(project.tracks, 'color'),
    },
    onError,
    nodes: [SoundNode, HeadingNode],
    editorState: initialEditorState(project),
  }

  function getAllSoundLocations() {
    return (
      editorRef.current?.getEditorState().read(() => {
        const root = $getRoot()
        // FIXME: is there a better way to get all nodes in order?
        const allNodes = root
          .getFirstDescendant()!
          .getNodesBetween(root.getLastDescendant()!)
        const soundNodes = allNodes.filter($isSoundNode)
        return processLocations(soundNodes.map((l) => l.getSoundLocation()))
      }) ?? []
    )
  }

  useImperativeHandle(
    ref,
    () =>
      ({
        getEditor() {
          return editorRef.current
        },
        updateSoundNode(key, locUpdate) {
          editorRef.current?.update(() => {
            const node = $getNodeByKey(key)
            if (!node || !$isSoundNode(node)) {
              console.warn('Unexpected node', node)
              return
            }
            const newLoc = { ...node.getSoundLocation(), ...locUpdate }
            node.setSoundLocation(newLoc)
            console.log('updated', newLoc)
          })
        },
        getAllSoundLocations,
      } satisfies EditorRef),
    [],
  )

  const onChange = debounce(function onChange(editorState: EditorState) {
    editorState.read(() => {
      const selection = $getSelection()

      if (!selection) {
        onSelect?.([], [])
        return
      }

      const selectedNodes = selection.getNodes()
      const soundNodes = selectedNodes.filter($isSoundNode)

      const rawLocs = soundNodes.map((l) => l.getSoundLocation())
      const locs = processLocations(rawLocs)
      onSelect?.(
        locs,
        soundNodes.map((n) => ({ ...n.exportJSON(), key: n.getKey() })),
      )
    })
  }, 150)

  const updateMetrics = debounce(function onChange(editorState: EditorState) {
    const allLocs = getAllSoundLocations()
    const endTime = getEndTime(allLocs)
    if (endTime === null) {
      return
    }
    onMetricsUpdated?.({ durationMS: endTime * 1000 })
  }, 150)

  useEffect(() => {
    const editorState = editorRef.current?.getEditorState()
    if (!editorState) {
      return
    }
    updateMetrics(editorState)
  }, [])

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <Container
        bg="white"
        maxW="container.lg"
        my="4"
        py="1"
        px="4"
        fontSize="xl"
        fontWeight="normal"
        borderRadius="lg"
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable className="editor-input" spellCheck={false} />
          }
          placeholder={
            <div className="editor-placeholder">Enter some plain text...</div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={onChange} />
        <OnChangePlugin onChange={updateMetrics} ignoreSelectionChange />
        <HistoryPlugin />
        <MarkdownShortcutPlugin transformers={[HEADING]} />
        <RefPlugin editorRef={editorRef} />
      </Container>
    </LexicalComposer>
  )
})

export default Editor
