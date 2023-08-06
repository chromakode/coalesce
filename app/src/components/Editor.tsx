import { HEADING } from '@lexical/markdown'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
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
import { $isSoundNode, SoundNode, lexicalNodes } from '@shared/lexical'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

import { ExcludedProperties, Provider } from '@lexical/yjs'
import type { Project, SoundLocation } from '@shared/types'
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  EditorState,
  LexicalEditor,
} from 'lexical'
import { debounce, mapValues } from 'lodash-es'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import {
  OffsetSoundLocation,
  getEndTime,
  getNodeKeyToLoc,
  processLocations,
} from '../lib/AudioEngine'
import { collabSocketBase } from '../lib/api'

const excludedProperties: ExcludedProperties = new Map()
excludedProperties.set(SoundNode, new Set(['__isPlaying']))

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
  colorMap: Record<string, string>
  getEditor: () => LexicalEditor | null
  updateSoundNode: (key: string, loc: Partial<SoundLocation>) => void
  setSoundNodePlaying: (key: string, isPlaying: boolean) => void
  scrollToKey: (key: string) => void
  getAllSoundLocations: () => OffsetSoundLocation[]
}

export interface EditorMetrics {
  durationMS: number
  nodeKeyToLoc: Record<string, OffsetSoundLocation>
}

export interface EditorProps {
  project: Project
  onSelect?: (locs: OffsetSoundLocation[], nodes: SoundNodeData[]) => void
  onMetricsUpdated?: (metrics: EditorMetrics) => void
}

export const COLOR_ORDER = [
  'red',
  'green',
  'blue',
  'yellow',
  'purple',
  'orange',
]

export const Editor = forwardRef<EditorRef, EditorProps>(function Editor(
  { project, onSelect, onMetricsUpdated },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null)
  const prevSelection = useRef<ReturnType<typeof $getSelection>>(null)

  const colorMap = useMemo(() => {
    const colorOrder = [...COLOR_ORDER]
    return mapValues(project.tracks, () => colorOrder.shift() ?? 'black')
  }, [project])

  const initialConfig: InitialConfigType = useMemo(() => {
    return {
      namespace: 'coalesce',
      nodes: lexicalNodes,
      theme: {
        ltr: 'ltr',
        rtl: 'rtl',
        placeholder: 'editor-placeholder',
        paragraph: 'editor-paragraph',
        sourceColors: colorMap,
      },
      onError,
      editorState: null, // CollaborationPlugin will set editor state
    }
  }, [project])

  function getAllSoundLocations() {
    return (
      editorRef.current?.getEditorState().read(() => {
        const root = $getRoot()
        // FIXME: is there a better way to get all nodes in order?
        const allNodes =
          root
            .getFirstDescendant()
            ?.getNodesBetween(root.getLastDescendant()!) ?? []
        const soundNodes = allNodes.filter($isSoundNode)
        return processLocations(soundNodes.map((l) => l.getSoundLocation()))
      }) ?? []
    )
  }

  useImperativeHandle(
    ref,
    () =>
      ({
        colorMap,
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

            // Ensure onSelect is called with updated locs
            prevSelection.current = null
          })
        },
        setSoundNodePlaying(key, isPlaying) {
          editorRef.current?.update(() => {
            const node = $getNodeByKey(key)
            if (!node) {
              console.warn('node not found', key)
              return
            }
            node.setIsPlaying(isPlaying)
          })
        },
        scrollToKey(key: string) {
          const el = editorRef.current?.getElementByKey(key)
          if (!el) {
            console.warn('unable to locate element for', key)
            return
          }
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        },
        getAllSoundLocations,
      } satisfies EditorRef),
    [],
  )

  const handleSelectionChange = debounce(function handleSelectionChange(
    editorState: EditorState,
  ) {
    editorState.read(() => {
      const selection = $getSelection()

      if (
        (selection == null && prevSelection.current == null) ||
        selection?.is(prevSelection.current)
      ) {
        return
      }
      prevSelection.current = selection

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
  },
  150)

  const handleChange = debounce(function handleChange() {
    const allLocs = getAllSoundLocations()
    const endTime = getEndTime(allLocs)
    if (endTime === null) {
      return
    }

    onMetricsUpdated?.({
      durationMS: endTime * 1000,
      nodeKeyToLoc: getNodeKeyToLoc(allLocs),
    })
  }, 500)

  useEffect(handleChange, [])

  const createWebsocketProvider = useCallback(
    (id: string, yjsDocMap: Map<string, Y.Doc>) => {
      const doc = new Y.Doc()
      yjsDocMap.set(id, doc)

      // TODO: create a custom provider to combine YJS and project updates in one WebSocket
      const provider = new WebsocketProvider(collabSocketBase(), id, doc, {
        connect: false,
      })

      // Lexical's type is stricter than YJS's :(
      return provider as unknown as Provider
    },
    [],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable className="editor-input" spellCheck={false} />
        }
        placeholder={
          <div className="editor-placeholder">Enter some plain text...</div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={handleSelectionChange} />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      <HistoryPlugin />
      <MarkdownShortcutPlugin transformers={[HEADING]} />
      <RefPlugin editorRef={editorRef} />
      <CollaborationPlugin
        id={`${project.projectId}/collab`}
        providerFactory={createWebsocketProvider}
        username="Editor"
        excludedProperties={excludedProperties}
        shouldBootstrap={false}
      />
    </LexicalComposer>
  )
})

export default Editor
