import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { flatten, pick, sortBy } from 'lodash-es'
import { Project } from './project'
import { $createSoundNode } from './SoundNode'

export interface Word {
  text: string
  start: number
  end: number
  confidence: number
}

export interface Segment {
  id: number
  start: number
  end: number
  text: string
  confidence: number
  words: Word[]
}

export interface Words {
  text: string
  segments: Segment[]
}

function allTaggedWords(words: Words, source: string) {
  const result = []
  for (const segment of words.segments) {
    for (const word of segment.words) {
      result.push({ source, ...word })
    }
  }
  return result
}

export function initialEditorState(project: Project) {
  const allWords = sortBy(
    flatten(
      Object.entries(project.tracks).map(([name, { words }]) =>
        allTaggedWords(words, name),
      ),
    ),
    'start',
  )

  // Lexical expects a function to call
  return () => {
    const root = $getRoot()

    let para = null
    let lastSource = null

    for (const word of allWords) {
      if (lastSource !== word.source) {
        para = $createParagraphNode()
        root.append(para)

        para.append($createTextNode(`${word.source}: `))

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
