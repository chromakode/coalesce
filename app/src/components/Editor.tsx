import { HEADING } from '@lexical/markdown'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import {
  InitialConfigType,
  LexicalComposer,
} from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import {
  $createSpeakerNode,
  $isSoundNode,
  $isSpeakerNode,
  $nodesOfTypeInOrder,
  $splitNodeShallow,
  $trimLeadingSpace,
  SoundNode,
  SpeakerNode,
  lexicalNodes,
} from '@shared/lexical'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

import { ExcludedProperties, Provider } from '@lexical/yjs'
import {
  BEFORE_PUNCTUATION,
  COLLAB_SERVER_INFO_MSG_TYPE,
} from '@shared/constants'
import type { Project, SoundLocation } from '@shared/types'
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  EditorState,
  LexicalEditor,
  LexicalNode,
  RangeSelection,
} from 'lexical'
import { decoding } from 'lib0'
import { debounce, escapeRegExp } from 'lodash-es'
import {
  MutableRefObject,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { useLatest } from 'react-use'
import {
  OffsetSoundLocation,
  getEndTime,
  getNodeKeyToLoc,
  processLocations,
} from '../lib/AudioEngine'
import { useAPI } from './APIContext'
import { OnChangePlugin } from './LexicalOnChangePlugin'

const precedingTextRe = new RegExp(`[${escapeRegExp(BEFORE_PUNCTUATION)}]+`)

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

function SpeakerPlugin({ project }: { project: Project }) {
  const [editor] = useLexicalComposerContext()

  // Reparent SoundNodes outside of a SpeakerNode (this commonly happens when
  // pressing enter splits a SpeakerNode)
  useLayoutEffect(() => {
    return editor.registerNodeTransform(SoundNode, (soundNode) => {
      const soundLoc = soundNode.getSoundLocation()
      const { source } = soundLoc
      const track = project.tracks[source]

      const createSpeakerNode = () => {
        return $createSpeakerNode(
          track?.label ?? 'Speaker',
          track?.color ?? 'black',
          source,
        )
      }

      const scanAdjacentNodes = (startNode: LexicalNode): LexicalNode[] => {
        const resultNodes: LexicalNode[] = []

        const isRelevantNode = (node: LexicalNode) => {
          if ($isSoundNode(node)) {
            return node.getSoundLocation().source === source
          }

          if ($isTextNode(node)) {
            return true
          }

          return false
        }

        let curNode: LexicalNode | null = startNode

        // Scan backwards to start or first node with different source
        let prevNode = curNode.getPreviousSibling()
        while (prevNode && isRelevantNode(prevNode)) {
          curNode = prevNode
          prevNode = curNode.getPreviousSibling()
        }

        // Scan forward through text nodes (so trailing punctuation stays with
        // the previous speaker)
        while (curNode && !$isSoundNode(curNode)) {
          curNode = curNode.getNextSibling()
        }

        // Scan forward, reparenting nodes
        while (
          curNode &&
          isRelevantNode(curNode) &&
          // Stop at text nodes containing punctuation that precedes words
          ($isSoundNode(curNode) ||
            !curNode.getTextContent().match(precedingTextRe))
        ) {
          resultNodes.push(curNode)
          curNode = curNode.getNextSibling()
        }

        return resultNodes
      }

      function reparentNode(node: LexicalNode, destNode: LexicalNode) {
        const origParentNode = node.getParent()
        node.remove()

        // If the previous parent is empty, remove it
        if (origParentNode?.isEmpty()) {
          origParentNode.remove()
        }

        destNode.append(node)
      }

      const selection = $getSelection()
      let prevSelection: RangeSelection | undefined
      if ($isRangeSelection(selection)) {
        prevSelection = selection.clone()
      }

      const parentNode = soundNode.getParentOrThrow()
      if (!$isSpeakerNode(parentNode) || parentNode.getSource() !== source) {
        const nodesToReparent = scanAdjacentNodes(soundNode)

        const speakerNode = createSpeakerNode()
        const [beforeParent, afterParent] = $splitNodeShallow(
          parentNode,
          nodesToReparent[0].getIndexWithinParent(),
        )
        if (afterParent !== null) {
          afterParent.insertBefore(speakerNode)
        } else {
          beforeParent.insertAfter(speakerNode)
        }

        for (const node of nodesToReparent) {
          reparentNode(node, speakerNode)
        }

        if (afterParent !== null) {
          $trimLeadingSpace(afterParent)
        }
      }

      if (prevSelection) {
        $setSelection(prevSelection)
      }
    })
  }, [editor, project])

  // Auto remove empty speaker nodes
  useLayoutEffect(() => {
    return editor.registerNodeTransform(SpeakerNode, (speakerNode) => {
      if (speakerNode.getTextContent().trim() === '') {
        speakerNode.remove()
      }
    })
  }, [])

  return null
}

export type SoundNodeData = ReturnType<SoundNode['exportJSON']> & {
  key: string
}

export interface EditorRef {
  getEditor: () => LexicalEditor | null
  updateSoundNode: (key: string, loc: Partial<SoundLocation>) => void
  setSoundNodePlaying: (key: string, isPlaying: boolean) => void
  scrollToKey: (key: string) => void
  getAllSoundLocations: () => OffsetSoundLocation[]
}

export interface EditorMetrics {
  start: number
  duration: number
  nodeKeyToLoc: Record<string, OffsetSoundLocation>
}

export interface EditorProps {
  project: Project
  initialNickname: string
  scrollerRef: MutableRefObject<HTMLElement | null>
  onSync: (syncData: {
    isSynced: boolean
    mixerSettingsDoc: Y.Map<unknown>
  }) => void
  onAwareness: (awareness: WebsocketProvider['awareness']) => void
  onSelect?: (selectionInfo: {
    nearestNodeKey: string | null
    locs: OffsetSoundLocation[]
    nodes: SoundNodeData[]
  }) => void
  onMetricsUpdated?: (metrics: EditorMetrics) => void
}

export const Editor = forwardRef<EditorRef, EditorProps>(function Editor(
  {
    project,
    initialNickname,
    scrollerRef,
    onSync,
    onAwareness,
    onSelect,
    onMetricsUpdated,
  },
  ref,
) {
  const { collabSocketProvider } = useAPI()
  const editorRef = useRef<LexicalEditor | null>(null)
  const prevSelection = useRef<ReturnType<typeof $getSelection>>(null)
  const cachedLocations = useRef<OffsetSoundLocation[] | null>(null)

  const initialConfig: InitialConfigType = useMemo(() => {
    return {
      namespace: 'coalesce',
      nodes: lexicalNodes,
      theme: {
        ltr: 'ltr',
        rtl: 'rtl',
        placeholder: 'editor-placeholder',
        paragraph: 'editor-paragraph',
      },
      onError,
      editorState: null, // CollaborationPlugin will set editor state
    }
  }, [project])

  function getAllSoundLocations() {
    if (!cachedLocations.current) {
      cachedLocations.current =
        editorRef.current?.getEditorState().read(() => {
          const soundNodes = $nodesOfTypeInOrder(SoundNode)
          return processLocations(soundNodes.map((l) => l.getSoundLocation()))
        }) ?? []
    }
    return cachedLocations.current
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

            // Ensure onSelect is called with updated locs
            prevSelection.current = null
          })
        },
        setSoundNodePlaying(key, isPlaying) {
          editorRef.current?.update(
            () => {
              const node = $getNodeByKey(key)
              if (!node) {
                console.warn('node not found', key)
                return
              }
              node.setIsPlaying(isPlaying)
            },
            { discrete: true, tag: 'skip-collab' },
          )
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
        onSelect?.({ nearestNodeKey: null, locs: [], nodes: [] })
        return
      }

      const selectedNodes = selection.getNodes()
      const soundNodes = selectedNodes.filter($isSoundNode)
      const nearestNodeKey = soundNodes[0]?.getKey() ?? null

      if ($isRangeSelection(selection) && selection.isCollapsed()) {
        onSelect?.({ nearestNodeKey, locs: [], nodes: [] })
        return
      }

      const rawLocs = soundNodes.map((l) => l.getSoundLocation())
      const locs = processLocations(rawLocs)
      onSelect?.({
        nearestNodeKey,
        locs,
        nodes: soundNodes.map((n) => ({ ...n.exportJSON(), key: n.getKey() })),
      })
    })
  },
  150)

  const updateMetrics = useCallback(() => {
    const allLocs = getAllSoundLocations()
    const endTime = getEndTime(allLocs)
    if (endTime === null) {
      return
    }

    onMetricsUpdated?.({
      start: allLocs[0].start + allLocs[0].offset,
      duration: endTime,
      nodeKeyToLoc: getNodeKeyToLoc(allLocs),
    })
  }, [getAllSoundLocations, onMetricsUpdated])

  const updateMetricsDebounced = useMemo(
    () =>
      debounce(updateMetrics, 500, {
        leading: true,
        trailing: true,
        maxWait: 2000,
      }),
    [updateMetrics],
  )

  const handleChange = (
    editorState: EditorState,
    editor: LexicalEditor,
    tags: Set<string>,
  ) => {
    if (!tags.has('skip-collab')) {
      cachedLocations.current = null
    }
    updateMetricsDebounced()
  }

  useEffect(updateMetricsDebounced, [])

  const latestOnSync = useLatest(onSync)
  const latestOnAwareness = useLatest(onAwareness)

  const createWebsocketProvider = useCallback(
    (id: string, yjsDocMap: Map<string, Y.Doc>) => {
      const doc = new Y.Doc()
      yjsDocMap.set(id, doc)

      // TODO: create a custom provider to combine YJS and project updates in one WebSocket
      const provider = collabSocketProvider(id, doc, { connect: false })

      provider.messageHandlers[COLLAB_SERVER_INFO_MSG_TYPE] = (
        encoder,
        decoder,
      ) => {
        const instanceId = decoding.readVarString(decoder)
        console.debug('Connected to collab server:', instanceId)
      }

      provider.on('sync', (isSynced: boolean) => {
        setTimeout(() => {
          cachedLocations.current = null
          updateMetrics()

          const mixerSettingsDoc = doc.getMap('mixerSettings')
          latestOnSync.current({ isSynced, mixerSettingsDoc })
        })
      })

      provider.awareness.on('change', () => {
        latestOnAwareness.current(provider.awareness)
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
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={handleSelectionChange} />
      <OnChangePlugin
        onChange={handleChange}
        ignoreSelectionChange
        includeInitialChange
      />
      <MarkdownShortcutPlugin transformers={[HEADING]} />
      <RefPlugin editorRef={editorRef} />
      <SpeakerPlugin project={project} />
      <CollaborationPlugin
        id={`${project.projectId}/collab`}
        providerFactory={createWebsocketProvider}
        excludedProperties={excludedProperties}
        shouldBootstrap={false}
        username={initialNickname}
        cursorsContainerRef={scrollerRef}
      />
    </LexicalComposer>
  )
})

export default Editor
