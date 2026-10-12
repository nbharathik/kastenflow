// Moving a block to a place between blocks, as a drag by its handle does:
// one transaction, and the block keeps whatever it holds, a
// toggle its title and insides. It is fitted to where it lands: a list item
// outside a list becomes a list of its own, a text block among list items
// becomes an item, a heading in the middle of a list splits the list, and
// an item takes the marker of the list it joins. What it leaves behind stays
// valid: a list left with no items goes, a toggle or callout keeps an empty
// line.

import { Fragment, type Node, type NodeType } from "@milkdown/kit/prose/model";
import { NodeSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { insertPoint } from "@milkdown/kit/prose/transform";

import { isList, type BlockAt } from "./units";

/** The range the block at `pos` leaves, and what fills it so its parent stays valid. */
export function leaving(doc: Node, pos: number, node: Node): { from: number; to: number; fill: Node | null } {
  return leavingRange(doc, pos, pos + node.nodeSize);
}

/** The range the sibling blocks from `start` to `end` leave, and what fills it so its parent stays valid. */
export function leavingRange(doc: Node, start: number, end: number): { from: number; to: number; fill: Node | null } {
  const $pos = doc.resolve(start);
  const paragraph = doc.type.schema.nodes.paragraph!;
  let from = start;
  let to = end;
  for (let depth = $pos.depth; ; depth--) {
    const parent = $pos.node(depth);
    const index = $pos.index(depth);
    // The blocks themselves at the first level; a parent that has to go is one child of its own parent.
    const upTo = depth === $pos.depth ? doc.resolve(end).index(depth) : index + 1;
    if (parent.canReplace(index, upTo)) return { from, to, fill: null };
    // A list without items goes; a toggle, a callout or the page keeps a line.
    if (depth > 0 && isList(parent)) {
      from = $pos.before(depth);
      to = $pos.after(depth);
      continue;
    }
    if (depth === 0 || parent.canReplaceWith(index, index + 1, paragraph)) return { from, to, fill: paragraph.create() };
    from = $pos.before(depth);
    to = $pos.after(depth);
  }
}

/** A list item with the marker of the list it is in, as Milkdown draws it. */
export function asItemOf(item: Node, list: NodeType): Node {
  if (!("listType" in item.attrs)) return item;
  const ordered = list.name === "ordered_list";
  const attrs = { ...item.attrs, listType: ordered ? "ordered" : "bullet", label: ordered ? "1." : "•" };
  return item.type.create(attrs, item.content, item.marks);
}

export interface Landing {
  /** Where to insert, and what. */
  pos: number;
  node: Node;
  /** Where the moved block's unit starts once inserted (before any split). */
  select: number;
  /** A list to split first, at `pos`: the block goes between the halves. */
  split?: boolean;
}

/** How `node` (a unit from a `from` list, or none) goes in at `at`, or null. */
export function landing(doc: Node, at: number, node: Node, from: NodeType | null): Landing | null {
  const $at = doc.resolve(at);
  const parent = $at.parent;
  const index = $at.index();
  const nodes = doc.type.schema.nodes;
  const item = nodes.list_item;
  if (parent.canReplaceWith(index, index, node.type)) {
    const placed = isList(parent) && node.type === item ? asItemOf(node, parent.type) : node;
    return { pos: at, node: placed, select: at };
  }
  if (node.type === item) {
    const list = from ?? nodes.bullet_list!;
    const wrapped = list.create(null, asItemOf(node, list));
    if (parent.canReplaceWith(index, index, list)) return { pos: at, node: wrapped, select: at + 1 };
  }
  if (item && isList(parent)) {
    if (item.validContent(Fragment.from(node))) {
      return { pos: at, node: asItemOf(item.create(null, node), parent.type), select: at };
    }
    // Anything else splits the list where it lands, or goes beside it at its ends.
    if (index > 0 && index < parent.childCount) return { pos: at, node, select: at, split: true };
  }
  const near = insertPoint(doc, at, node.type);
  return near === null ? null : { pos: near, node, select: near };
}

/**
 * Moves the block `from` to `target`, a position between blocks; null when
 * it cannot go there or would not move (a drop on or inside itself).
 */
export function moveBlockTo(state: EditorState, from: BlockAt, target: number): Transaction | null {
  const { doc } = state;
  const end = from.pos + from.node.nodeSize;
  if (doc.nodeAt(from.pos) !== from.node || (target >= from.pos && target <= end)) return null;
  const $from = doc.resolve(from.pos);
  const list = isList($from.parent) ? $from.parent.type : null;
  const tr = state.tr;
  const gone = leaving(doc, from.pos, from.node);
  if (gone.fill) tr.replaceWith(gone.from, gone.to, gone.fill);
  else tr.delete(gone.from, gone.to);
  const land = landing(tr.doc, tr.mapping.map(target), from.node, list);
  if (!land) return null;
  if (land.split) tr.split(land.pos);
  const at = land.split ? land.pos + 1 : land.pos;
  tr.insert(at, land.node);
  const select = land.select + (land.split ? 1 : 0);
  if (NodeSelection.isSelectable(tr.doc.nodeAt(select)!)) tr.setSelection(NodeSelection.create(tr.doc, select));
  return tr.setMeta("uiEvent", "drop");
}
