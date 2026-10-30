// The selected part of a page written as Markdown, the way the page writes it
// (bold stays bold, a list stays a list); when that cannot be done the plain
// text of the selection.

import { editorViewCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";

export function selectionMarkdown(ctx: Ctx): string {
  const view = ctx.get(editorViewCtx);
  const { from, to } = view.state.selection;
  try {
    const { topNodeType } = ctx.get(schemaCtx);
    const markdown = ctx.get(serializerCtx)(topNodeType.create(null, view.state.doc.slice(from, to).content)).trim();
    if (markdown !== "") return markdown;
  } catch {
    // A selection that is not whole blocks may not fit a page; its text still goes.
  }
  return view.state.doc.textBetween(from, to, "\n\n");
}
