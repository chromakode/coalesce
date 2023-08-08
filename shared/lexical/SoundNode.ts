import { SoundLocation } from '../types.ts'

// @deno-types="https://esm.sh/lexical@0.11.3?pin=130"
import { TextNode } from 'lexical'
import type { EditorConfig, LexicalNode, NodeKey } from 'lexical'

function isPlayingStyle(isPlaying: boolean) {
  return isPlaying ? '"GRAD" 150, "YOPQ" 100' : ''
}

function updateStyle(
  config: EditorConfig,
  element: HTMLElement,
  loc: SoundLocation,
  isPlaying: boolean,
) {
  element.style.color = config.theme.sourceColors[loc.source] ?? 'black'
  element.style.fontVariationSettings = isPlayingStyle(isPlaying)
  element.style.textDecoration = isPlaying ? 'underline' : ''
}

export class SoundNode extends TextNode {
  __soundLoc: SoundLocation
  __isPlaying: boolean

  constructor(text: string, loc: SoundLocation, key?: NodeKey) {
    super(text, key)
    this.__soundLoc = { ...loc }
    this.__isPlaying = false
  }

  static getType(): string {
    return 'sound'
  }

  static clone(node: SoundNode): SoundNode {
    return new SoundNode(node.__text, node.__soundLoc, node.__key)
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    updateStyle(config, element, this.__soundLoc, this.__isPlaying)
    return element
  }

  updateDOM(
    prevNode: SoundNode,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    if (super.updateDOM(prevNode, dom, config)) {
      return true
    }
    if (
      prevNode.__isPlaying !== this.__isPlaying ||
      prevNode.__soundLoc !== this.__soundLoc
    ) {
      updateStyle(config, dom, this.__soundLoc, this.__isPlaying)
    }
    return false
  }

  getSoundLocation() {
    const self = this.getLatest()
    return { ...self.__soundLoc, key: this.getKey() }
  }

  setSoundLocation(loc: SoundLocation) {
    const self = this.getWritable()
    self.__soundLoc = { ...loc }
    return self
  }

  setIsPlaying(isPlaying: boolean) {
    const self = this.getWritable()
    self.__isPlaying = isPlaying
    return self
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
