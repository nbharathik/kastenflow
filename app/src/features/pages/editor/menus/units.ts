// Blocks as the handle sees them, Notion's way: each list item, each block
// inside a toggle or callout, and tables, quotes and code blocks whole; and
// the gaps between them where a dragged block lands.

import type { Node } from "@milkdown/kit/prose/model";

export interface BlockAt {
  pos: number;
  node: Node;
}

/** Blocks whose insides move with them: no handle of their own inside. */
const WHOLE = new Set(["table", "blockquote", "code_block"]);
/** Blocks whose children each get a handle. */
const HOLDERS = new Set(["doc", "toggle", "callout", "column"]);
const LISTS = new Set(["bullet_list", "ordered_list"]);

export const isList = (node: Node) => LISTS.has(node.type.name);

/** The block a handle belongs to around the node at `inside`. */
export function blockUnit(doc: Node, inside: number): BlockAt | null {
  const node = inside >= 0 ? doc.nodeAt(inside) : null;
  if (!node) return null;
  const $pos = doc.resolve(inside);
  const chain: BlockAt[] = [];
  for (let depth = 1; depth <= $pos.depth; depth++) chain.push({ pos: $pos.before(depth), node: $pos.node(depth) });
  chain.push({ pos: inside, node });
  const whole = chain.find((c) => WHOLE.has(c.node.type.name));
  if (whole) return whole;
  for (let i = chain.length - 1; i >= 0; i--) {
    const at = chain[i]!;
    if (at.node.type.name === "list_item") return at;
    const parent = i === 0 ? doc : chain[i - 1]!.node;
    if (at.node.isBlock && HOLDERS.has(parent.type.name)) return at;
  }
  return null;
}

/** The block under a point from `posAtCoords`, between blocks included. */
export function blockNear(doc: Node, hit: { pos: number; inside: number }): BlockAt | null {
  if (hit.inside >= 0) return blockUnit(doc, hit.inside);
  const $pos = doc.resolve(hit.pos);
  // Between blocks, at any depth: the block after the gap, else the one before it.
  if ($pos.nodeAfter?.isBlock) return blockUnit(doc, hit.pos);
  if ($pos.nodeBefore?.isBlock) return blockUnit(doc, hit.pos - $pos.nodeBefore.nodeSize);
  return $pos.depth > 0 ? blockUnit(doc, $pos.before()) : null;
}

/** The unit a unit sits inside: its toggle or callout, its list's item, or its list. */
export function outerUnit(doc: Node, at: BlockAt): BlockAt | null {
  const $pos = doc.resolve(at.pos);
  const depth = $pos.depth;
  if (depth === 0) return null;
  if (isList($pos.parent) && depth >= 2 && $pos.node(depth - 1).type.name === "list_item") {
    return { pos: $pos.before(depth - 1), node: $pos.node(depth - 1) };
  }
  // Out of a column is out of the columns block: the columns themselves are not places a block lands.
  if ($pos.parent.type.name === "column" && depth >= 2) return { pos: $pos.before(depth - 1), node: $pos.node(depth - 1) };
  return { pos: $pos.before(depth), node: $pos.parent };
}

/** How far left of a level's insides, in pixels, a dragged block goes out of it. */
export const STEP = 12;

export interface Gap {
  /** Where the block lands. */
  pos: number;
  /** The unit it lands beside, and on which side. */
  at: BlockAt;
  after: boolean;
}

/**
 * Where a block dropped on one side of `unit` lands. After the last block
 * of a list, toggle or callout, and before the first item of a list, a
 * block held more than STEP left of those insides (`inset`, in pixels)
 * lands outside instead, one level at a time, so a paragraph dragged to
 * the end of a list stays a paragraph unless it is moved in.
 */
export function dropGap(doc: Node, unit: BlockAt, after: boolean, inset: (at: BlockAt) => number): Gap {
  let at = unit;
  for (;;) {
    const $pos = doc.resolve(at.pos);
    const index = $pos.index();
    const outer = outerUnit(doc, at);
    // Above a list's first item is above the list, when the list is a block of its own.
    const edge = after ? index === $pos.parent.childCount - 1 : index === 0 && isList($pos.parent) && outer?.node === $pos.parent;
    if (!edge || !outer || inset(at) <= STEP) break;
    at = outer;
  }
  return { pos: after ? at.pos + at.node.nodeSize : at.pos, at, after };
}
