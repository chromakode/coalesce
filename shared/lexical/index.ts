import { HeadingNode } from '@lexical/rich-text'
import { SoundNode } from './SoundNode.ts'

export const lexicalNodes = [SoundNode, HeadingNode]
export { $isSoundNode, $createSoundNode, SoundNode } from './SoundNode.ts'
