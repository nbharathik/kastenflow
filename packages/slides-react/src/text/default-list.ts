// A body slot makes a list of the words typed into it, but shows no bullet while
// it is empty: the first words that go in turn its paragraphs into items. A
// paragraph whose list a person took off (which leaves its words where they
// stood) is left plain.

import type { ListKind } from "@kasten-slides/wasm";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

import { attrsOf } from "./schema.ts";

const isEmpty = (doc: PMNode): boolean => {
  let empty = true;
  doc.forEach((node) => {
    if (node.content.size > 0) empty = false;
  });
  return empty;
};

/** Makes list items of the paragraphs of a box that goes from empty to holding words. */
export function defaultListPlugin(kind: ListKind): Plugin {
  return new Plugin({
    appendTransaction(transactions, before, after) {
      if (!transactions.some((tr) => tr.docChanged) || !isEmpty(before.doc) || isEmpty(after.doc)) return null;
      const tr = after.tr;
      after.doc.forEach((node, pos) => {
        const attrs = attrsOf(node);
        if (attrs.list === null && attrs.marginLeft === null && attrs.indent === null && node.content.size > 0) tr.setNodeMarkup(pos, undefined, { ...node.attrs, list: kind });
      });
      return tr.docChanged ? tr : null;
    },
  });
}
