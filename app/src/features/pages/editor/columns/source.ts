// A columns node remembers the Markdown it was read from, so saving can copy
// what did not change. That text rides on the node as an attribute whose value
// ProseMirror's deep comparison cannot see into (no enumerable properties):
// two columns blocks with the same columns are equal whatever they were read
// from, so reopening a saved page gives the document the editor held.

import type { Node } from "@milkdown/kit/prose/model";

export class SourceBox {
  readonly #text: string;
  readonly #context: string;

  /** `context` is the page's link reference and footnote definitions, which blocks of the columns may use. */
  constructor(text: string, context = "") {
    this.#text = text;
    this.#context = context;
  }

  get text(): string {
    return this.#text;
  }

  get context(): string {
    return this.#context;
  }
}

/** For a columns block made in the editor, or pasted: no source. */
export const NO_SOURCE = new SourceBox("");

export function sourceOf(node: Node): string {
  const box: unknown = node.attrs.source;
  return box instanceof SourceBox ? box.text : "";
}

/** The definitions the block's source was read with ("" for a block with no source). */
export function contextOf(node: Node): string {
  const box: unknown = node.attrs.source;
  return box instanceof SourceBox ? box.context : "";
}
