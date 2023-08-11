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
