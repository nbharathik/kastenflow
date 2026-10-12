// Keys that act on several blocks at once: with a range selected, or text
// running over more than one block. With one block they do what they always did.

import type { Command } from "@milkdown/kit/prose/state";

import { blocksOfSelection, BlockRangeSelection, type BlocksAt } from "./block-range";
import { currentBlock, editSelectedBlock } from "./block-nav";
import { duplicateBlock } from "./block-ops";
import type { BlockKind } from "./catalog";
import { deleteBlocks, duplicateBlocks, groupIntoToggle } from "./range-ops";
import { turnInto } from "./transform";
import { turnBlocksInto } from "./turn-blocks";

/** Backspace or Delete with a range of blocks selected removes them all. */
export const deleteRange: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof BlockRangeSelection)) return false;
  return deleteBlocks({ from: selection.from, to: selection.to, count: selection.indexes.end - selection.indexes.start })(state, dispatch);
};

/** Esc with a range selected puts the caret in its last block, ending the selection. */
export const leaveRange: Command = (state, dispatch, view) => (state.selection instanceof BlockRangeSelection ? editSelectedBlock(state, dispatch, view) : false);

/** The blocks to act on: those a selection spans, else the one around the caret. */
function target(state: Parameters<Command>[0]): BlocksAt | null {
  const spanned = blocksOfSelection(state);
  if (spanned) return spanned;
  const block = currentBlock(state);
  return block ? { from: block.pos, to: block.pos + block.node.nodeSize, count: 1 } : null;
}

/** Ctrl+D copies the selected blocks (or the block around the caret) below them. */
export const duplicateSelected: Command = (state, dispatch, view) => {
  const range = target(state);
  if (!range) return false;
  return range.count > 1 ? duplicateBlocks(range)(state, dispatch, view) : duplicateBlock(range.from)(state, dispatch, view);
};

/** Ctrl+Alt+T puts the selected blocks into one toggle: the first becomes its title. */
export const groupSelected: Command = (state, dispatch, view) => {
  const range = target(state);
  return range ? groupIntoToggle(range)(state, dispatch, view) : false;
};

/** Ctrl+Alt+digit: the kind for every block selected, or the one around the caret. */
export const turnSelected =
  (kind: BlockKind): Command =>
  (state, dispatch, view) => {
    const range = blocksOfSelection(state);
    if (!range) return turnInto(kind)(state, dispatch, view);
    const tr = turnBlocksInto(state, range, kind);
    if (tr) dispatch?.(tr.scrollIntoView());
    return tr !== null;
  };
