import { $getRoot, LexicalNode, Klass } from 'lexical'
import { HeadingNode } from '@lexical/rich-text'
import { SoundNode } from './SoundNode.ts'
import { SpeakerNode } from './SpeakerNode.ts'

export const lexicalNodes = [SoundNode, SpeakerNode, HeadingNode]
export { $isSoundNode, $createSoundNode, SoundNode } from './SoundNode.ts'
export {
  $isSpeakerNode,
  $createSpeakerNode,
  SpeakerNode,
} from './SpeakerNode.ts'

export function $nodesOfTypeInOrder<T extends LexicalNode>(
  klass: Klass<T>,
): Array<T> {
  const root = $getRoot()
  const allNodes =
    root.getFirstDescendant()?.getNodesBetween(root.getLastDescendant()!) ?? []
  const nodes = allNodes.filter((n): n is T => n instanceof klass)
  return nodes
}
