import { EditorConfig, LexicalNode, NodeKey, TextNode } from 'lexical'
import { SoundLocation } from './AudioEngine'

export class SoundNode extends TextNode {
  __soundLoc: SoundLocation

  constructor(text: string, loc: SoundLocation, key?: NodeKey) {
    super(text, key)
    this.__soundLoc = loc
  }

  static getType(): string {
    return 'sound'
  }

  static clone(node: SoundNode): SoundNode {
    return new SoundNode(node.__text, node.__soundLoc, node.__key)
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.style.color =
      config.theme.sourceColors[this.__soundLoc.source] ?? 'black'
    return element
  }

  getSoundLocation() {
    const self = this.getLatest()
    return self.__soundLoc
  }

  setSoundLocation(loc: SoundLocation) {
    const self = this.getWritable()
    self.__soundLoc = loc
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      soundLoc: this.__soundLoc,
      type: 'sound',
    }
  }

  static importJSON(
    serializedNode: ReturnType<SoundNode['exportJSON']>,
  ): TextNode {
    const node = $createSoundNode(serializedNode.text, serializedNode.soundLoc)
    return node
  }
}

export function $createSoundNode(
  text: string,
  soundLoc: SoundLocation,
): SoundNode {
  return new SoundNode(text, soundLoc)
}

export function $isSoundNode(node?: LexicalNode): node is SoundNode {
  return node instanceof SoundNode
}
