// What a person can do to columns: make them, set their widths, and move a
// block from one to the next (Alt+Left and Alt+Right, the keyboard way of
// dragging a block across).

import type { Node } from "@milkdown/kit/prose/model";
import { NodeSelection, TextSelection, type Command, type EditorState } from "@milkdown/kit/prose/state";

const isBlankParagraph = (node: Node) => node.type.name === "paragraph" && node.content.size === 0;

/** Whether the position is inside a column. */
export function inColumn(doc: Node, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === "column") return true;
  return false;
}

/** Columns with a line to type in each. An empty line becomes them; otherwise they go below the block the caret is in. */
export function insertColumns(count: number): Command {
  return (state, dispatch) => {
    const { columns, column, paragraph } = state.schema.nodes;
    const { $from } = state.selection;
    if (!columns || !column || !paragraph || $from.depth < 1 || inColumn(state.doc, $from.pos)) return false;
    const block = columns.create(
      { ratio: "" },
      Array.from({ length: count }, () => column.create(null, paragraph.create())),
    );
    if (dispatch) {
      const emptyLine = $from.depth === 1 && isBlankParagraph($from.parent);
      const tr = state.tr;
      const at = emptyLine ? $from.before(1) : $from.after(1);
      if (emptyLine) tr.replaceWith(at, $from.after(1), block);
      else tr.insert(at, block);
      // Into the first line of the first column.
      tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Sets the widths of the columns block at `pos` (`40/60`, or "" for equal). */
export function setColumnsRatio(pos: number, ratio: string): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== "columns") return false;
    if (node.attrs.ratio === ratio) return true;
    dispatch?.(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ratio }));
    return true;
  };
}

/** The block of a column the selection is in: the one selected, else the one around the caret (a whole list, not its item). */
function blockInColumn(state: EditorState): { pos: number; node: Node } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.$from.parent.type.name === "column") return { pos: selection.from, node: selection.node };
  const { $from } = selection;
  for (let depth = $from.depth; depth >= 1; depth--) {
    if ($from.node(depth - 1).type.name === "column") return { pos: $from.before(depth), node: $from.node(depth) };
  }
  return null;
}

/**
 * Moves the block around the caret (or the selected block) into the column
 * beside it, to the same place in the order, or the end of a shorter one.
 * False when it is not in a column or there is no column that way.
 */
export function moveAcross(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const block = blockInColumn(state);
    if (!block) return false;
    const { doc } = state;
    const $block = doc.resolve(block.pos);
    const columns = $block.node(-1);
    const target = $block.index(-1) + dir;
    if (target < 0 || target >= columns.childCount) return false;
    if (!dispatch) return true;

    // Where the target column's blocks start, and where in them the block goes.
    let columnPos = $block.start(-1);
    for (let i = 0; i < target; i++) columnPos += columns.child(i).nodeSize;
    const into = columns.child(target);
    const index = Math.min($block.index(), into.childCount);
    let at = columnPos + 1;
    for (let i = 0; i < index; i++) at += into.child(i).nodeSize;
    const placeholder = into.childCount === 1 && isBlankParagraph(into.firstChild!);

    const { paragraph } = state.schema.nodes;
    const size = block.node.nodeSize;
    const tr = state.tr;
    // A column never holds nothing: the block that was its only one leaves a blank line.
    if ($block.parent.childCount === 1) tr.replaceWith(block.pos, block.pos + size, paragraph!.create());
    else tr.delete(block.pos, block.pos + size);
    const place = tr.mapping.map(at);
    if (placeholder) tr.replaceWith(place, place + into.firstChild!.nodeSize, block.node);
    else tr.insert(place, block.node);

    const { from, to } = state.selection;
    const inside = (pos: number) => tr.doc.resolve(place + Math.min(Math.max(pos - block.pos, 0), size));
    tr.setSelection(state.selection instanceof NodeSelection ? NodeSelection.create(tr.doc, place) : TextSelection.between(inside(from), inside(to)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
