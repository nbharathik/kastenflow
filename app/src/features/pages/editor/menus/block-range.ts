// Several blocks selected at once, as Notion does with Shift+Up and Down, a
// Shift+click or a drag through the margin. A BlockRangeSelection is modelled
// on ProseMirror's CellSelection: it spans from before the first block to
// after the last, between siblings of one parent, so a list's items, a
// toggle's insides or the page's own blocks. The browser's text selection is
// hidden and the blocks are tinted instead.

import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type SelectionBookmark } from "@milkdown/kit/prose/state";
import type { Mappable } from "@milkdown/kit/prose/transform";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { blockNear, blockUnit, outerUnit, type BlockAt } from "./units";

/** Whether two positions between blocks bound a range of siblings. */
function bounds($anchor: ResolvedPos, $head: ResolvedPos): boolean {
  return $anchor.pos !== $head.pos && $anchor.sameParent($head) && !$anchor.parent.inlineContent;
}

export class BlockRangeSelection extends Selection {
  /** `$anchor` is where the selection started, `$head` where it was last extended to;
   * both are between blocks of one parent. */
  constructor($anchor: ResolvedPos, $head: ResolvedPos) {
    super($anchor, $head);
  }

  /** The browser's own selection is not drawn: the blocks are tinted. */
  override visible = false;

  /** The first block's index in its parent, and the one after the last. */
  get indexes(): { start: number; end: number } {
    const { $from, $to } = this;
    return { start: $from.index(), end: $to.index() };
  }

  /** The selected blocks, with where each starts. */
  blocks(): BlockAt[] {
    const found: BlockAt[] = [];
    this.$from.parent.forEach((node, offset) => {
      const pos = this.$from.start() + offset;
      if (pos >= this.from && pos < this.to) found.push({ pos, node });
    });
    return found;
  }

  map(doc: Node, mapping: Mappable): Selection {
    const $anchor = doc.resolve(mapping.map(this.anchor));
    const $head = doc.resolve(mapping.map(this.head));
    return bounds($anchor, $head) ? new BlockRangeSelection($anchor, $head) : Selection.near($head);
  }

  eq(other: Selection): boolean {
    return other instanceof BlockRangeSelection && other.anchor === this.anchor && other.head === this.head;
  }

  toJSON(): { type: string; anchor: number; head: number } {
    return { type: "blockRange", anchor: this.anchor, head: this.head };
  }

  override getBookmark(): SelectionBookmark {
    return new RangeBookmark(this.anchor, this.head);
  }

  static override fromJSON(doc: Node, json: { anchor: number; head: number }): BlockRangeSelection {
    const $anchor = doc.resolve(json.anchor);
    const $head = doc.resolve(json.head);
    if (!bounds($anchor, $head)) throw new RangeError("Invalid input for BlockRangeSelection.fromJSON");
    return new BlockRangeSelection($anchor, $head);
  }
}

Selection.jsonID("blockRange", BlockRangeSelection);

class RangeBookmark implements SelectionBookmark {
  constructor(
    private readonly anchor: number,
    private readonly head: number,
  ) {}

  map(mapping: Mappable): RangeBookmark {
    return new RangeBookmark(mapping.map(this.anchor), mapping.map(this.head));
  }

  resolve(doc: Node): Selection {
    const $anchor = doc.resolve(this.anchor);
    const $head = doc.resolve(this.head);
    return bounds($anchor, $head) ? new BlockRangeSelection($anchor, $head) : Selection.near($head);
  }
}

/** The blocks the selection is on, as one range of siblings: from where the
 * first starts to where the last ends. Null when no block is selected. */
export interface BlocksAt {
  from: number;
  to: number;
  /** How many blocks. */
  count: number;
}

/** The sibling blocks selected as blocks: a block range, or one block selected whole. */
export function pickedBlocks(selection: Selection): BlocksAt | null {
  if (selection instanceof BlockRangeSelection) return { from: selection.from, to: selection.to, count: selection.indexes.end - selection.indexes.start };
  if (selection instanceof NodeSelection) return { from: selection.from, to: selection.to, count: 1 };
  return null;
}

/** The blocks a selection spans, as sibling blocks: a block range, one block
 * selected whole, or text running over several blocks (the smallest range of
 * siblings holding where it starts and ends). Null for text within one block. */
export function blocksOfSelection(state: EditorState): BlocksAt | null {
  const { selection, doc } = state;
  const picked = pickedBlocks(selection);
  if (picked || !(selection instanceof TextSelection) || selection.$from.sameParent(selection.$to)) return picked;
  const unitAt = ($pos: ResolvedPos) => blockUnit(doc, $pos.before($pos.depth));
  const [a, b] = [unitAt(selection.$from), unitAt(selection.$to)];
  const spanned = a && b ? rangeBetween(doc, a.pos, b.pos) : null;
  return spanned ? pickedBlocks(spanned) : null;
}

/** The blocks of `range`, in order. */
export function blocksIn(doc: Node, range: BlocksAt): Node[] {
  const $from = doc.resolve(range.from);
  const found: Node[] = [];
  for (let i = $from.index(); i < $from.index() + range.count; i++) found.push($from.parent.child(i));
  return found;
}

/** The selection for the blocks from `from` to `to`, which are siblings:
 * one block whole when it is one, else a range. `forward` says which end
 * was fixed when the range began. */
export function selectBlocks(doc: Node, from: number, to: number, forward = true): Selection | null {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if (!bounds($from, $to)) return null;
  if ($to.index() - $from.index() === 1) {
    const only = doc.nodeAt(from);
    return only && NodeSelection.isSelectable(only) ? NodeSelection.create(doc, from) : null;
  }
  return forward ? new BlockRangeSelection($from, $to) : new BlockRangeSelection($to, $from);
}

/** The smallest range of sibling blocks holding both blocks, `a` and `b` (the
 * positions before them), as a selection that began at `a`. A block holding
 * the other is the range alone. */
export function rangeBetween(doc: Node, a: number, b: number): Selection | null {
  const $a = doc.resolve(a);
  const depth = $a.sharedDepth(b);
  const $b = doc.resolve(b);
  const first = $a.index(depth);
  const second = $b.index(depth);
  const [low, high] = first <= second ? [first, second] : [second, first];
  return selectBlocks(doc, $a.posAtIndex(low, depth), $a.posAtIndex(high + 1, depth), first <= second);
}

/** One step up or down: the range or block selected, grown by the sibling
 * beyond its moving end (or shrunk, going back). Past the edge of a list, a
 * toggle or a callout it climbs: the whole list, toggle or callout is selected,
 * and the next step goes on among its siblings. */
export function extendedBlocks(state: EditorState, dir: -1 | 1): Selection | null {
  const { selection, doc } = state;
  const picked = pickedBlocks(selection);
  if (!picked) return null;
  const $from = doc.resolve(picked.from);
  const parent = $from.parent;
  const depth = $from.depth;
  // Where the fixed end and the moving end are, as boundaries between children.
  const single = selection instanceof NodeSelection;
  const start = $from.index();
  const end = start + picked.count;
  const forward = single ? dir > 0 : selection.head >= selection.anchor;
  const fixed = single ? (dir > 0 ? start : end) : forward ? start : end;
  const moving = single ? (dir > 0 ? end : start) : forward ? end : start;
  const next = moving + dir;
  if (next < 0 || next > parent.childCount) {
    // Past the edge: the unit around these blocks.
    const outer = depth === 0 ? null : outerUnit(doc, { pos: picked.from, node: parent.child(start) });
    return outer && NodeSelection.isSelectable(outer.node) ? NodeSelection.create(doc, outer.pos) : null;
  }
  // A range of two shrinks to one block, which is selected whole.
  const low = Math.min(fixed, next);
  const high = Math.max(fixed, next);
  return selectBlocks(doc, $from.posAtIndex(low, depth), $from.posAtIndex(high, depth), next > fixed);
}

/** Puts the caret at the end of the last block of the selection, leaving block selection. */
export function leaveBlocks(state: EditorState): Selection | null {
  const picked = pickedBlocks(state.selection);
  if (!picked) return null;
  return TextSelection.findFrom(state.doc.resolve(picked.to), -1, true);
}

/** Shift+click on a block while a block or several are selected: the selection
 * grows from the block it began at to the one clicked. True when it did. */
export function shiftClickBlocks(view: EditorView, event: { clientX: number; clientY: number }): boolean {
  const { selection, doc } = view.state;
  const picked = pickedBlocks(selection);
  if (!picked) return false;
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const clicked = hit && blockNear(doc, hit);
  if (!clicked) return false;
  // Where the selection began: the first block, or the last when it was grown upwards.
  const began = selection instanceof BlockRangeSelection && selection.anchor > selection.head ? selection.blocks().at(-1)! : { pos: picked.from };
  const next = rangeBetween(doc, began.pos, clicked.pos);
  if (!next) return false;
  if (!next.eq(selection)) view.dispatch(view.state.tr.setSelection(next));
  return true;
}

const key = new PluginKey<DecorationSet>("KASTEN_BLOCK_RANGE");

/** Tints the blocks of a block range (a lone selected block is tinted by ProseMirror itself). */
export const blockRangePlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply(_tr, previous, _old, state) {
          const { selection } = state;
          if (!(selection instanceof BlockRangeSelection)) return previous === DecorationSet.empty ? previous : DecorationSet.empty;
          return DecorationSet.create(
            state.doc,
            selection.blocks().map(({ pos, node }) => Decoration.node(pos, pos + node.nodeSize, { class: "kasten-range-picked" })),
          );
        },
      },
      props: {
        decorations: (state) => key.getState(state),
        handleDOMEvents: {
          mousedown(view, event) {
            if (event.button !== 0 || !event.shiftKey || !shiftClickBlocks(view, event)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    }),
);
