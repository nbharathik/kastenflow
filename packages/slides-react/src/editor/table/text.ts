// The words of a table for the text controls (size, font, colour, bold, alignment and the rest) when the table is selected but no cell is
// open for writing: the cells picked, else every cell. A change is laid on their words with the engine's `set_cells`, one step of undo.

import type { CellValue, Element, Text } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";
import { fillCells, fillRange } from "./fill.ts";

type TableEl = Extract<Element, { type: "table" }>;
type Operations = Parameters<EditorSession["core"]["applyBatch"]>[0];

/** The text style the words of a cell are set in. */
export const CELL_STYLE = "body";

/** The words of the cells a text control acts on: the cells picked in this table, else all of them. */
export function tableTexts(session: EditorSession, table: TableEl): { text: Text; baseStyle: string }[] {
  return fillCells(session, table).map((laid) => ({ text: laid.cell.text, baseStyle: CELL_STYLE }));
}

/** The operation that gives each of those cells the words `change` makes of its own; none when nothing changes. */
export function tableTextOperations(session: EditorSession, table: TableEl, change: (text: Text, baseStyle: string) => Text): Operations {
  const range = fillRange(session, table);
  // A value for the first place of each cell; nothing (which the engine skips) for the places a merged cell covers.
  const values: CellValue[][] = Array.from({ length: range.bottom - range.top + 1 }, () => Array.from({ length: range.right - range.left + 1 }, (): CellValue => ({})));
  let changed = false;
  for (const laid of fillCells(session, table)) {
    const next = change(laid.cell.text, CELL_STYLE);
    if (next === laid.cell.text || JSON.stringify(next) === JSON.stringify(laid.cell.text)) continue;
    const row = values[laid.row - range.top];
    if (row) row[laid.col - range.left] = { text: next };
    changed = true;
  }
  if (!changed) return [];
  return [["set_cells", { slide: session.state.slideId, id: table.id, at: { row: range.top, col: range.left }, cells: values, grow: false }]];
}
