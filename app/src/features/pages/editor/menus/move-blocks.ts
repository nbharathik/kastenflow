// Moving several blocks at once to a place between blocks, as a drag by the
// handle does with a range selected: one transaction, and the blocks keep what
// they hold. They are fitted to where they land as one block is (move-block.ts):
// list items among list items stay items, outside a list they become a list of
// their own, and what they leave behind stays valid.

import type { Node } from "@milkdown/kit/prose/model";
import { NodeSelection, type EditorState, type Selection, type Transaction } from "@milkdown/kit/prose/state";

import { selectBlocks, type BlocksAt } from "./block-range";
import { asItemOf, landing, leavingRange, moveBlockTo } from "./move-block";
import { isList } from "./units";

/**
 * Moves the sibling blocks `range` to `target`, a position between blocks;
 * null when they cannot go there or would not move (a drop on or inside
 * themselves). The blocks moved are what is selected after.
 */
export function moveBlocksTo(state: EditorState, range: BlocksAt, target: number): Transaction | null {
  const { doc } = state;
  if (range.count === 1) {
    const node = doc.nodeAt(range.from);
    return node ? moveBlockTo(state, { pos: range.from, node }, target) : null;
  }
  if (target >= range.from && target <= range.to) return null;
  const $from = doc.resolve(range.from);
  const parent = $from.parent;
  const nodes: Node[] = [];
  for (let i = $from.index(); i < $from.index() + range.count; i++) nodes.push(parent.child(i));
  const list = isList(parent) ? parent.type : null;
  const schema = doc.type.schema.nodes;
  const tr = state.tr;
  const gone = leavingRange(doc, range.from, range.to);
  if (gone.fill) tr.replaceWith(gone.from, gone.to, gone.fill);
  else tr.delete(gone.from, gone.to);
  let at = tr.mapping.map(target);

  /** What went in: where the first starts, where the last ends. */
  let placed: { from: number; to: number } | null = null;
  const put = (pos: number, node: Node | readonly Node[]) => {
    const all = Array.isArray(node) ? (node as readonly Node[]) : [node as Node];
    tr.insert(pos, all as Node[]);
    const end = pos + all.reduce((sum, n) => sum + n.nodeSize, 0);
    placed = { from: placed?.from ?? pos, to: end };
    return end;
  };

  if (nodes.every((node) => node.type === schema.list_item)) {
    const $at = tr.doc.resolve(at);
    const index = $at.index();
    if ($at.parent.canReplaceWith(index, index, schema.list_item!)) {
      // Among the items of a list, they are items with its marker.
      const into = isList($at.parent) ? $at.parent.type : null;
      put(at, into ? nodes.map((item) => asItemOf(item, into)) : nodes);
    } else {
      // Anywhere else they make a list of their own.
      const kind = list ?? schema.bullet_list!;
      const wrapped = kind.create(null, nodes.map((item) => asItemOf(item, kind)));
      const land = landing(tr.doc, at, wrapped, null);
      if (!land) return null;
      if (land.split) tr.split(land.pos);
      put(land.split ? land.pos + 1 : land.pos, land.node);
    }
  } else {
    for (const node of nodes) {
      const land = landing(tr.doc, at, node, list);
      if (!land) return null;
      if (land.split) tr.split(land.pos);
      at = put(land.split ? land.pos + 1 : land.pos, land.node);
    }
  }

  const moved = placed as { from: number; to: number } | null;
  if (moved) {
    // Siblings are selected as a range; a lone block, or ones split apart by the landing, as the first.
    let selection: Selection | null = selectBlocks(tr.doc, moved.from, moved.to);
    if (!selection) {
      const first = tr.doc.nodeAt(moved.from);
      selection = first && NodeSelection.isSelectable(first) ? NodeSelection.create(tr.doc, moved.from) : null;
    }
    if (selection) tr.setSelection(selection);
  }
  return tr.setMeta("uiEvent", "drop");
}
