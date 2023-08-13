import { SoundLocation } from '../types.ts'

// @deno-types="https://esm.sh/lexical@0.11.3?pin=130"
import { TextNode } from 'lexical'
import type { EditorConfig, LexicalNode, NodeKey, TextModeType } from 'lexical'

function isPlayingStyle(isPlaying: boolean) {
  return isPlaying ? '"GRAD" 150, "YOPQ" 100' : ''
}

function updateStyle(element: HTMLElement, isPlaying: boolean) {
  element.style.fontVariationSettings = isPlayingStyle(isPlaying)
  element.style.textDecoration = isPlaying ? 'underline' : ''
  element.style.color = isPlaying ? `var(--label-color)` : ''
}

export class SoundNode extends TextNode {
  __soundStart: number
  __soundEnd: number
  __soundSource: string
  __isPlaying: boolean

  constructor(text: string, loc: SoundLocation, key?: NodeKey) {
    super(text, key)
    if (loc) {
      this.__soundStart = loc.start
      this.__soundEnd = loc.end
      this.__soundSource = loc.source
    }
    this.__isPlaying = false
  }

  static getType(): string {
    return 'sound'
  }

  static clone(node: SoundNode): SoundNode {
    return new SoundNode(node.__text, node.getSoundLocation(), node.__key)
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    updateStyle(element, this.__isPlaying)
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
      prevNode.__soundStart !== this.__soundStart ||
      prevNode.__soundEnd !== this.__soundEnd ||
      prevNode.__soundSource !== this.__soundSource
    ) {
      updateStyle(dom, this.__isPlaying)
    }
    return false
  }

  isUnmergeable(): boolean {
    return true
  }

  splitText(...splitOffsets: number[]): TextNode[] {
    const self = this.getLatest()
    const nodes = super.splitText(...splitOffsets)
    const soundLoc = self.getSoundLocation()
    const soundNodes = nodes.map((node) => {
      if ($isSoundNode(node)) {
        return node
      }
      const soundNode = $createSoundNode(node.getTextContent(), soundLoc)
      node.replace(soundNode)
      return soundNode
    })
    return soundNodes
  }

  getSoundLocation() {
    const self = this.getLatest()
    return {
      start: self.__soundStart,
      end: self.__soundEnd,
      source: self.__soundSource,
      key: self.getKey(),
    }
  }

  setSoundLocation(loc: SoundLocation) {
    const self = this.getWritable()
    self.__soundStart = loc.start
    self.__soundEnd = loc.end
    self.__soundSource = loc.source
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
      soundStart: this.__soundStart,
      soundEnd: this.__soundEnd,
      soundSource: this.__soundSource,
      type: 'sound',
    }
  }

  static importJSON(
    serializedNode: ReturnType<SoundNode['exportJSON']>,
  ): SoundNode {
    const node = $createSoundNode(serializedNode.text, {
      start: serializedNode.soundStart,
      end: serializedNode.soundEnd,
      source: serializedNode.soundSource,
    })
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
