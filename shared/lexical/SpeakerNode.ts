// @deno-types="https://esm.sh/lexical@0.11.3?pin=130"
import { ParagraphNode } from 'lexical'
import type { EditorConfig, LexicalNode, NodeKey } from 'lexical'

export class SpeakerNode extends ParagraphNode {
  __label: string | null
  __source: string

  constructor(label: string | null, source: string, key?: NodeKey) {
    super(key)
    this.__label = label
    this.__source = source
  }

  static getType(): string {
    return 'speaker'
  }

  static clone(node: SpeakerNode): SpeakerNode {
    return new SpeakerNode(node.__label, node.__source, node.__key)
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.dataset.label = this.__label
    return element
  }

  updateDOM(
    prevNode: SpeakerNode,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    dom.dataset.label = this.__label
    return false
  }

  getLabel() {
    const self = this.getLatest()
    return self.__label
  }

  setLabel(label: string) {
    const self = this.getWritable()
    self.__label = label
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
      source: this.__source,
      type: 'speaker',
    }
  }

  static importJSON(
    serializedNode: ReturnType<SpeakerNode['exportJSON']>,
  ): SpeakerNode {
    const node = $createSpeakerNode(serializedNode.label, serializedNode.source)
    return node
  }
}

export function $createSpeakerNode(
  label: string | null,
  source: string,
): SpeakerNode {
  return new SpeakerNode(label, source)
}

export function $isSpeakerNode(node?: LexicalNode): node is SpeakerNode {
  return node instanceof SpeakerNode
}
