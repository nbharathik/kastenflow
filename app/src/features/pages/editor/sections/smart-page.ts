// "/smart page": two sections to start, and the sections layout on. The page
// gets a `---` line and room to write on each side of it; the layout is the
// page's `layout: sections` key, which the page around the editor writes when
// it is told (smartPageCtx).

import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";
import { TextSelection, type Command } from "@milkdown/kit/prose/state";

import { SMART_META, smartPageCtx, type SmartMeta } from "./key";
import { firstDivider } from "./model";

export function smartPage(ctx: Ctx): Command {
  return (state, dispatch) => {
    const { paragraph, hr } = state.schema.nodes;
    const { $from } = state.selection;
    if (!paragraph || !hr || $from.depth < 1) return false;
    const start = $from.before(1);
    const end = start + $from.node(1).nodeSize;
    const empty = $from.node(1).type === paragraph && $from.node(1).content.size === 0;
    // A page with a divider already gets one more section; one without gets two.
    const fresh = firstDivider(state.doc) === null && empty;
    const nodes: Node[] = fresh ? [paragraph.create(), hr.create(), paragraph.create()] : [hr.create(), paragraph.create()];
    const tr = state.tr;
    if (empty) tr.replaceWith(start, end, nodes);
    else tr.insert(end, nodes);
    // Writing starts in the first section when it is new, else in the new one.
    const caret = (empty ? start : end) + (fresh ? 1 : nodes[0]!.nodeSize + 1);
    tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));
    tr.setMeta(SMART_META, { smart: true } satisfies SmartMeta);
    dispatch?.(tr.scrollIntoView());
    ctx.get(smartPageCtx.key)?.();
    return true;
  };
}
