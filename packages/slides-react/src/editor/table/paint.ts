// The paint format brush on a table: what it picks up from the cell the keys move from, and what it lays on the cells picked (the whole
// table when none are): their words and paragraphs with the engine's `set_cells`, and their fill with `set_cell_fill`. One step of undo.

import type { CellValue, Element, Fill } from "@kasten-slides/wasm";

import { formatOfText } from "../../text/commands.ts";
import { brushOf, carriesText, paintText } from "../toolbar/paint-text.ts";
import type { EditorSession } from "../session/session.ts";
import type { PaintFormat } from "../ui-state.ts";
import { gridOf, originOf } from "./cells.ts";
import { fillCells, fillRange, operationsFor } from "./fill.ts";

type TableEl = Extract<Element, { type: "table" }>;
type Operations = Parameters<EditorSession["core"]["applyBatch"]>[0];

/** The cell a brush is picked up from: the one the keys move from when cells are picked in this table, else the first. */
function sourceCell(session: EditorSession, table: TableEl) {
  const grid = gridOf(table);
  const focus = session.state.cells?.table === table.id ? session.state.cells.focus : { row: 0, col: 0 };
  const origin = originOf(grid, focus);
  return grid.at(origin.row, origin.col);
}

/** The brush a table's cell makes: the looks of its words and its paragraphs, and its fill (none picks up "no fill"). */
export function captureCell(session: EditorSession, table: TableEl): PaintFormat | null {
  const cell = sourceCell(session, table);
  if (!cell) return null;
  const format = formatOfText(session.deck.theme, "body", cell.cell.text);
  const fill = cell.cell.fill ?? null;
  return { ...brushOf(format), style: fill ? { fill: structuredClone(fill) } : {} };
}

/** The operations that lay a brush on the cells of a table that a control would act on: the cells picked, else all. */
export function paintOperations(session: EditorSession, paint: PaintFormat, table: TableEl): Operations {
  const slide = session.state.slideId;
  const operations: Operations = [];
  const range = fillRange(session, table);
  if (carriesText(paint)) {
    const rows = range.bottom - range.top + 1;
    const columns = range.right - range.left + 1;
    // A value for the first place of each cell; nothing (which the engine skips) for the places a merged cell covers.
    const values: CellValue[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, (): CellValue => ({})));
    let changed = false;
    for (const laid of fillCells(session, table)) {
      const text = paintText(session.deck.theme, "body", laid.cell.text, paint);
      if (text === laid.cell.text) continue;
      const row = values[laid.row - range.top];
      if (row) row[laid.col - range.left] = { text };
      changed = true;
    }
    if (changed) operations.push(["set_cells", { slide, id: table.id, at: { row: range.top, col: range.left }, cells: values, grow: false }]);
  }
  // A brush that came from a block or a cell has a fill, or none: laid on cells it gives them that fill or takes theirs away.
  if (paint.style) {
    const want = (paint.style.fill ?? null) as Fill | null;
    operations.push(...operationsFor(slide, table, range, fillCells(session, table), () => (want ? structuredClone(want) : null)));
  }
  return operations;
}
