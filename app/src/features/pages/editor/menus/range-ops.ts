// What the block menu and the keys do to several selected blocks: delete,
// duplicate, colour and group into a toggle. Each is one transaction, so one
// undo takes it back.

import type { Node } from "@milkdown/kit/prose/model";
import { NodeSelection, Selection, TextSelection, type Command, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import type { NotionColor } from "../blocks/color";
import { blocksIn, selectBlocks, type BlocksAt } from "./block-range";
import { colorBlocks } from "./block-ops";
import { chain, titleOf } from "./transform";

/** Removes the blocks from the note (undo brings them back). Parents left
 * empty go too, as a list without items would. */
export function deleteBlocks(range: BlocksAt): Command {
  return (state, dispatch) => {
    const { doc } = state;
    if (!doc.nodeAt(range.from)) return false;
    const $pos = doc.resolve(range.from);
    let from = range.from;
    let to = range.to;
    let count = range.count;
    for (let depth = $pos.depth; depth >= 1 && $pos.node(depth).childCount === count; depth--) {
      from = $pos.before(depth);
      to = $pos.after(depth);
      count = 1;
    }
    const tr = state.tr;
    if (from === 0 && to === doc.content.size) tr.replaceWith(from, to, state.schema.nodes.paragraph!.create());
    else tr.deleteRange(from, to);
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Inserts copies of the blocks right after them, and selects the copies. */
export function duplicateBlocks(range: BlocksAt): Command {
  return (state, dispatch) => {
    const nodes = blocksIn(state.doc, range);
    if (nodes.length === 0) return false;
    const tr = state.tr.insert(range.to, nodes);
    const end = range.to + nodes.reduce((sum, node) => sum + node.nodeSize, 0);
    const selection = selectBlocks(tr.doc, range.to, end);
    tr.setSelection(selection ?? Selection.near(tr.doc.resolve(range.to + 1)));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Colours the text of the blocks, keeping them selected. */
export function colorBlockRange(view: EditorView, range: BlocksAt, mark: "text_color" | "bg_color", color: NotionColor | null): void {
  const { state } = view;
  const start = Selection.findFrom(state.doc.resolve(range.from), 1, true);
  const end = Selection.findFrom(state.doc.resolve(range.to), -1, true);
  if (!start || !end || end.to < start.from || end.to > range.to) return;
  const tr = chain(state, [colorBlocks(mark, color)], state.tr.setSelection(TextSelection.between(start.$from, end.$to)));
  if (tr) view.dispatch(tr.setSelection(state.selection.map(tr.doc, tr.mapping)));
}

/** Whether the blocks can be grouped into a toggle where they are. */
export function canGroup(state: EditorState, range: BlocksAt): boolean {
  const toggle = state.schema.nodes.toggle;
  const $from = state.doc.resolve(range.from);
  return Boolean(toggle) && $from.parent.canReplaceWith($from.index(), $from.index() + range.count, toggle!);
}

/** Puts the blocks into one toggle: a first paragraph or heading becomes its
 * title and the rest its body; any other first block leaves the title empty. */
export function groupIntoToggle(range: BlocksAt): Command {
  return (state, dispatch) => {
    if (!canGroup(state, range)) return false;
    const { schema } = state;
    const nodes = blocksIn(state.doc, range);
    const first = nodes[0]!;
    const titled = first.type === schema.nodes.paragraph || first.type === schema.nodes.heading;
    const body: Node[] = titled ? nodes.slice(1) : nodes;
    const toggle = schema.nodes.toggle!.create({ open: true, summary: titled ? titleOf(first) : "" }, body.length > 0 ? body : [schema.nodes.paragraph!.create()]);
    const tr = state.tr.replaceWith(range.from, range.to, toggle);
    tr.setSelection(NodeSelection.create(tr.doc, range.from));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
