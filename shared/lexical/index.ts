import invariant from 'tiny-invariant'
import { $getRoot, LexicalNode, Klass, ElementNode, $copyNode } from 'lexical'
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

// Like $splitNode, but doesn't split parents recursively
export function $splitNodeShallow(
  node: ElementNode,
  offset: number,
): [null, ElementNode] | [ElementNode, null] | [ElementNode, ElementNode] {
  if (offset === 0) {
    return [null, node]
  } else if (offset === node.getChildrenSize()) {
    return [node, null]
  }

  let startNode = node.getChildAtIndex(offset)
  invariant(startNode != null)

  const afterNode = $copyNode(node)
  afterNode.append(startNode, ...startNode.getNextSiblings())
  node.insertAfter(afterNode)

  return [node, afterNode]
}
