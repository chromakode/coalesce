// @deno-types="https://esm.sh/lexical@0.12.2?pin=130"
import { ParagraphNode } from 'lexical'
import type { EditorConfig, LexicalNode, NodeKey } from 'lexical'

export class SpeakerNode extends ParagraphNode {
  __label: string | null
  __color: string | null
  __source: string

  constructor(
    label: string | null,
    color: string | null,
    source: string,
    key?: NodeKey,
  ) {
    super(key)
    this.__label = label
    this.__color = color
    this.__source = source
  }

  static getType(): string {
    return 'speaker'
  }

  static clone(node: SpeakerNode): SpeakerNode {
    return new SpeakerNode(
      node.__label,
      node.__color,
      node.__source,
      node.__key,
    )
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.dataset.label = this.__label ?? undefined
    element.style.setProperty(
      '--label-color',
      `var(--chakra-colors-${this.__color}-600)`,
    )
    return element
  }

  updateDOM(
    prevNode: SpeakerNode,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    dom.dataset.label = this.__label ?? undefined
    dom.dataset.color = this.__color ?? undefined
    return false
  }

  getLabel() {
    const self = this.getLatest()
    return self.__label
  }

  setLabel(label: string, color: string) {
    const self = this.getWritable()
    self.__label = label
    self.__color = color
    return self
  }

  getSource() {
    const self = this.getLatest()
    return self.__source
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      label: this.__label,
      color: this.__color,
      source: this.__source,
      type: 'speaker',
    }
  }

  static importJSON(
    serializedNode: ReturnType<SpeakerNode['exportJSON']>,
  ): SpeakerNode {
    const node = $createSpeakerNode(
      serializedNode.label,
      serializedNode.color,
      serializedNode.source,
    )
    return node
  }
}

export function $createSpeakerNode(
  label: string | null,
  color: string | null,
  source: string,
): SpeakerNode {
  return new SpeakerNode(label, color, source)
}

export function $isSpeakerNode(node?: LexicalNode): node is SpeakerNode {
  return node instanceof SpeakerNode
}
