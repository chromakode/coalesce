// Modified version from Lexical to allow triggering on initial change
// Source: https://github.com/facebook/lexical/blob/55bb44444450b3dbcad2a0b422e1cb353c889f70/packages/lexical-react/src/LexicalOnChangePlugin.ts
// FIXME: PR to Lexical

import type { EditorState, LexicalEditor } from 'lexical'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLayoutEffect } from 'react'

export function OnChangePlugin({
  ignoreHistoryMergeTagChange = true,
  ignoreSelectionChange = false,
  includeInitialChange = false,
  onChange,
}: {
  ignoreHistoryMergeTagChange?: boolean
  ignoreSelectionChange?: boolean
  includeInitialChange?: boolean
  onChange: (
    editorState: EditorState,
    editor: LexicalEditor,
    tags: Set<string>,
  ) => void
}): null {
  const [editor] = useLexicalComposerContext()

  useLayoutEffect(() => {
    if (onChange) {
      return editor.registerUpdateListener(
        ({
          editorState,
          dirtyElements,
          dirtyLeaves,
          prevEditorState,
          tags,
        }) => {
          if (
            (ignoreSelectionChange &&
              dirtyElements.size === 0 &&
              dirtyLeaves.size === 0) ||
            (ignoreHistoryMergeTagChange && tags.has('history-merge')) ||
            (!includeInitialChange && prevEditorState.isEmpty())
          ) {
            return
          }

          onChange(editorState, editor, tags)
        },
      )
    }
  }, [editor, ignoreHistoryMergeTagChange, ignoreSelectionChange, onChange])

  return null
}
