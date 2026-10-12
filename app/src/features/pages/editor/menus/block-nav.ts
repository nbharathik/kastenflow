// Blocks as Notion sees them: the list item, quote or text block around the
// caret. Esc selects it, the arrow keys step between selected blocks, and
// Ctrl+Shift+Up/Down move it among its siblings.

import type { Node } from "@milkdown/kit/prose/model";
import { NodeSelection, TextSelection, type Command, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { carryFolds } from "../blocks/toggle-view";
import { isHidden } from "../sections/api";
import { extendedBlocks, pickedBlocks } from "./block-range";
import { moveBlocksTo } from "./move-blocks";

export interface BlockAt {
  pos: number;
  node: Node;
}

/** The block the selection is in: a selected block, else the list item or
 * quote around the caret's text block, else that text block. */
export function currentBlock(state: EditorState): BlockAt | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) return { pos: selection.from, node: selection.node };
  const { $from } = selection;
  if ($from.depth < 1) return null;
  let depth = $from.depth;
  while (depth > 1) {
    const parent = $from.node(depth - 1).type.name;
    if (parent !== "list_item" && parent !== "blockquote") break;
    depth--;
  }
  return { pos: $from.before(depth), node: $from.node(depth) };
}

/**
 * Keeps a block selected after a move. Crepe's list items, drawn anew by the
 * move, put back a text selection a frame later, which would leave the moved
 * block's text selected under the formatting toolbar instead.
 */
export function keepBlockSelected(view: EditorView): void {
  const { selection, doc } = view.state;
  if (!(selection instanceof NodeSelection)) return;
  requestAnimationFrame(() => {
    const now = view.state.selection;
    if (view.isDestroyed || view.state.doc !== doc || now instanceof NodeSelection) return;
    if (now.from < selection.from || now.to > selection.to) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, selection.from)));
  });
}

/** Selects the block around the caret, as Esc does in Notion. */
export const selectCurrentBlock: Command = (state, dispatch) => {
  if (state.selection instanceof NodeSelection) return false;
  const block = currentBlock(state);
  if (!block || !NodeSelection.isSelectable(block.node)) return false;
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, block.pos)));
  return true;
};

/** With a block or several selected, selects the sibling before (-1) or after (1) them. */
export function stepBlockSelection(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const picked = pickedBlocks(state.selection);
    if (!picked) return false;
    const $pos = state.doc.resolve(picked.from);
    const index = $pos.index();
    const parent = $pos.parent;
    // Past a range is the block after its last; a folded section's blocks are not stepped on.
    let target = dir > 0 ? index + picked.count : index - 1;
    while (target >= 0 && target < parent.childCount && isHidden(state, $pos.posAtIndex(target) + 1)) target += dir;
    if (target < 0 || target >= parent.childCount) return true;
    const pos = $pos.posAtIndex(target);
    if (NodeSelection.isSelectable(parent.child(target))) {
      dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
    }
    return true;
  };
}

/** With a block or several selected, Shift and an arrow grow the selection by the block beyond it (or shrink it). */
export function extendBlockSelection(dir: -1 | 1): Command {
  return (state, dispatch) => {
    if (!pickedBlocks(state.selection)) return false;
    const next = extendedBlocks(state, dir);
    if (next) dispatch?.(state.tr.setSelection(next).scrollIntoView());
    return true;
  };
}

/** With a block or several selected, puts the caret at the end of the last one's text to edit it. */
export const editSelectedBlock: Command = (state, dispatch) => {
  const { selection } = state;
  const picked = pickedBlocks(selection);
  if (!picked) return false;
  const target = TextSelection.findFrom(state.doc.resolve(picked.to), -1, true);
  if (!target || target.from < picked.from) return false;
  dispatch?.(state.tr.setSelection(target));
  return true;
};

/** Moves the current block, or the several selected, above the sibling before (-1) or below the one after (1). */
export function moveBlock(dir: -1 | 1): Command {
  return (state, dispatch, view) => {
    const picked = pickedBlocks(state.selection);
    if (picked && picked.count > 1) {
      const $pos = state.doc.resolve(picked.from);
      const sibling = $pos.parent.maybeChild(dir < 0 ? $pos.index() - 1 : $pos.index() + picked.count);
      if (!sibling) return true;
      const tr = moveBlocksTo(state, picked, dir < 0 ? picked.from - sibling.nodeSize : picked.to + sibling.nodeSize);
      if (tr && dispatch && view) carryFolds(view, picked.from, picked.to);
      if (tr) dispatch?.(tr.scrollIntoView());
      return true;
    }
    const block = currentBlock(state);
    if (!block) return false;
    const $pos = state.doc.resolve(block.pos);
    const index = $pos.index();
    const sibling = $pos.parent.maybeChild(index + dir);
    if (!sibling) return true;
    const size = block.node.nodeSize;
    const { from, to } = state.selection;
    const wasNode = state.selection instanceof NodeSelection;
    const tr = state.tr.delete(block.pos, block.pos + size);
    const at = dir < 0 ? block.pos - sibling.nodeSize : block.pos + sibling.nodeSize;
    tr.insert(at, block.node);
    // The block moved whole, so the caret keeps its place inside it; of a
    // selection reaching past it, the part inside it stays selected.
    const inside = (pos: number) => tr.doc.resolve(at + Math.min(Math.max(pos - block.pos, 0), size));
    const selection = wasNode ? NodeSelection.create(tr.doc, at) : TextSelection.between(inside(from), inside(to));
    // An open toggle stays open as it moves.
    if (dispatch && view) carryFolds(view, block.pos, block.pos + size);
    dispatch?.(tr.setSelection(selection).scrollIntoView());
    if (dispatch && view) keepBlockSelected(view);
    return true;
  };
}
