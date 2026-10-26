// Columns live at the top level of a page and do not nest: a columns block
// dragged, pasted or moved into a column (or a list, quote, callout or toggle) is
// refused, so the page never holds what Markdown cannot say.

import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/** Whether a columns block sits anywhere but the top level of the page: in a column, but also in a
 * list item, quote, callout or toggle, where its markers would read back as plain comments. */
export function hasNestedColumns(doc: Node): boolean {
  let nested = false;
  doc.descendants((node, _pos, parent) => {
    if (nested) return false;
    if (node.type.name === "columns" && parent !== doc) nested = true;
    return !nested;
  });
  return nested;
}

/** Whether a step of `tr` brings a columns block in. */
function bringsColumns(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as { slice?: { content: Node["content"] } }).slice;
    let found = false;
    slice?.content.descendants((node) => {
      if (node.type.name === "columns") found = true;
      return !found;
    });
    return found;
  });
}

export const columnsGuard = $prose(
  () =>
    new Plugin({
      key: new PluginKey("KASTEN_COLUMNS_GUARD"),
      filterTransaction: (tr) => !tr.docChanged || !bringsColumns(tr) || !hasNestedColumns(tr.doc),
    }),
);
