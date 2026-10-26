// Table edits as ProseMirror commands: add a row or a column next to the one
// the caret is in, align a column, and Tab at the last cell. The Markdown they
// write is the editor's own (see patch.ts for how little of it changes).

import type { Node } from "@milkdown/kit/prose/model";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { addColumn, addRow, isInTable, selectedRect, TableMap, type TableRect } from "@milkdown/kit/prose/tables";

import type { Align } from "./cells";

export interface InTable {
  /** Where the table node starts. */
  pos: number;
  node: Node;
  row: number;
  col: number;
  rect: TableRect;
}

/** The table around the selection and the cell it is in; null outside a table. */
export function tableAround(state: EditorState): InTable | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return { pos: rect.tableStart - 1, node: rect.table, row: rect.top, col: rect.left, rect };
}

/** The document position of cell (`row`, `col`) of the table at `tablePos`. */
function cellPos(doc: Node, tablePos: number, row: number, col: number): number {
  const table = doc.nodeAt(tablePos)!;
  const map = TableMap.get(table);
  return tablePos + 1 + map.map[row * map.width + col]!;
}

const alignmentOf = (cell: Node | null | undefined): Align => {
  const value = cell?.attrs.alignment;
  return value === "left" || value === "center" || value === "right" ? value : null;
};

function setColumnAlignment(tr: Transaction, tablePos: number, col: number, align: Align): void {
  const table = tr.doc.nodeAt(tablePos)!;
  for (let row = 0; row < table.childCount; row++) {
    const at = cellPos(tr.doc, tablePos, row, col);
    const cell = tr.doc.nodeAt(at)!;
    if (alignmentOf(cell) !== align) tr.setNodeMarkup(at, undefined, { ...cell.attrs, alignment: align });
  }
}

/** Aligns column `col` of the table around the selection: its header and every cell below. */
export function alignColumn(align: Align, col?: number) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const at = tableAround(state);
    if (!at) return false;
    const column = col ?? at.col;
    if (column < 0 || column >= at.rect.map.width) return false;
    const tr = state.tr;
    setColumnAlignment(tr, at.pos, column, align);
    if (tr.docChanged) dispatch?.(tr);
    return true;
  };
}

/** The alignment of the column the caret is in, as its header says. */
export function columnAlignment(state: EditorState): Align {
  const at = tableAround(state);
  return at ? alignmentOf(at.node.firstChild?.maybeChild(at.col)) : null;
}

/** Puts the caret at the start of cell (`row`, `col`). */
function caretIn(tr: Transaction, tablePos: number, row: number, col: number): void {
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos(tr.doc, tablePos, row, col) + 2)));
}

/** A row below (or above) the caret's, the caret in its first cell; it aligns as the columns do. */
export function insertRow(where: "below" | "above") {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const at = tableAround(state);
    if (!at) return false;
    if (!dispatch) return true;
    // Above the header is not a row: the table's first row is always its header.
    const index = where === "below" ? at.rect.bottom : Math.max(1, at.rect.top);
    const tr = addRow(state.tr, at.rect, index);
    const header = at.node.firstChild!;
    for (let col = 0; col < at.rect.map.width; col++) {
      const align = alignmentOf(header.maybeChild(col));
      const cell = cellPos(tr.doc, at.pos, index, col);
      const node = tr.doc.nodeAt(cell)!;
      if (alignmentOf(node) !== align) tr.setNodeMarkup(cell, undefined, { ...node.attrs, alignment: align });
    }
    caretIn(tr, at.pos, index, at.col);
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** A column right (or left) of the caret's, aligned as its neighbour is, the caret in its header. */
export function insertColumn(where: "right" | "left") {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const at = tableAround(state);
    if (!at) return false;
    if (!dispatch) return true;
    const index = where === "right" ? at.rect.right : at.rect.left;
    const tr = addColumn(state.tr, at.rect, index);
    setColumnAlignment(tr, at.pos, index, alignmentOf(at.node.firstChild!.maybeChild(where === "right" ? index - 1 : index)));
    caretIn(tr, at.pos, 0, index);
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Tab in the last cell of a table adds a row and goes into it, as a spreadsheet does. */
export const tabPastEnd = (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
  const at = tableAround(state);
  if (!at || !(state.selection instanceof TextSelection)) return false;
  if (at.rect.bottom !== at.rect.map.height || at.rect.right !== at.rect.map.width) return false;
  const first = insertRow("below");
  if (!dispatch) return true;
  // The caret goes to the first cell of the new row, not its own column's.
  return first(state, (tr) => {
    caretIn(tr, at.pos, at.rect.map.height, 0);
    dispatch(tr);
  });
};
