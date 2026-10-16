// The fill of the cells of a table, for the Fill section of the panel and the paint brush: the cells picked, else every cell of the table.
// A fill is set with the engine's own operation, over a block when the cells all come to the same fill, else cell by cell.

import type { Element, Fill } from "@kasten-slides/wasm";

import type { LaidCell } from "../../render/table-layout.ts";
import type { EditorSession } from "../session/session.ts";
import { type CellRange, cellsIn, gridOf, rangeOfSelection } from "./cells.ts";

type TableEl = Extract<Element, { type: "table" }>;
type Operations = Parameters<EditorSession["core"]["applyBatch"]>[0];

/** The most cells whose fills may each be set by an operation of their own, when a change leaves them different. */
const MOST_APART = 1000;

const same = (a: Fill | null, b: Fill | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The block of a table a fill control is about: the cells picked in it (made whole), else all of it. */
export function fillRange(session: EditorSession, table: TableEl): CellRange {
  const cells = session.state.cells;
  if (cells && cells.table === table.id) return rangeOfSelection(table, cells);
  const grid = gridOf(table);
  return { top: 0, left: 0, bottom: Math.max(grid.rows - 1, 0), right: Math.max(grid.cols - 1, 0) };
}

/** The cells whose fill a control shows. */
export function fillCells(session: EditorSession, table: TableEl): LaidCell[] {
  return cellsIn(gridOf(table), fillRange(session, table));
}

/** The operations that give each cell of `range` the fill `change` makes of its own. */
export function operationsFor(slide: string, table: TableEl, range: CellRange, targets: readonly LaidCell[], change: (fill: Fill | null) => Fill | null): Operations {
  const planned = targets.map((laid) => ({ laid, was: laid.cell.fill ?? null, next: change(laid.cell.fill ?? null) }));
  const moving = planned.filter((p) => !same(p.was, p.next));
  const first = moving[0];
  if (!first) return [];
  const block = { from: { row: range.top, col: range.left }, to: { row: range.bottom, col: range.right } };
  // The cells all come to one fill: one operation over the block (the cells that already have it are set again, which changes nothing).
  if (planned.every((p) => same(p.next, first.next))) return [["set_cell_fill", { slide, id: table.id, ...block, ...(first.next ? { fill: first.next } : {}) }]];
  if (moving.length > MOST_APART) return [["set_cell_fill", { slide, id: table.id, ...block, ...(first.next ? { fill: first.next } : {}) }]];
  return moving.map((p) => {
    const at = { row: p.laid.row, col: p.laid.col };
    return ["set_cell_fill", { slide, id: table.id, from: at, to: at, ...(p.next ? { fill: p.next } : {}) }];
  });
}

/** Changes the fill of the cells picked in each table (all its cells when none are picked there): one step of undo for all. */
export function changeFills(session: EditorSession, tables: readonly TableEl[], change: (fill: Fill | null) => Fill | null): void {
  const slide = session.state.slideId;
  const operations = tables.flatMap((table) => operationsFor(slide, table, fillRange(session, table), fillCells(session, table), change));
  if (operations.length > 0) session.run(() => session.core.applyBatch(operations));
}
