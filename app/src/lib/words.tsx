import type { Project, Words } from '@shared/types'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { flatten, pick, sortBy } from 'lodash-es'
import { $createSoundNode } from '../components/SoundNode'

function allTaggedWords(words: Words, source: string, speakerName: string) {
  const result = []
  for (const segment of words.segments) {
    for (const word of segment.words) {
      result.push({ source, speakerName, ...word })
    }
  }
  return result
}

export function projectToEditorState(project: Project) {
  const allWords = sortBy(
    flatten(
      Object.values(project.tracks).map(({ words, id, name }) =>
        allTaggedWords(words, id, name ?? 'Speaker'),
      ),
    ),
    'start',
  )

  // Lexical expects a function to call
  return () => {
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
  }
}
