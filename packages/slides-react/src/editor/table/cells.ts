// Which cells of a table are picked, and where the keys move the pick. A table's rows list only the cells that start in them (a cell that a
// row above covers has no entry), so the grid is read from the same layout the table is drawn with: what is picked is always whole cells,
// and a range that cuts a merged cell grows to take all of it.

import type { Element, Slide, TableEl } from "@kasten-slides/wasm";

import { type LaidCell, type Place, layoutTable } from "../../render/table-layout.ts";
import { findElement } from "../session/scope.ts";

export type { Place } from "../../render/table-layout.ts";

/** The cells picked in a table: the place a drag began at and the place it has reached. Either may be inside a merged cell. */
export interface CellSelection {
  table: string;
  anchor: Place;
  focus: Place;
}

/** A block of places, edges included. */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** What the picking needs of a table: the spans, not the sizes. */
export type GridSource = Pick<TableEl, "columns" | "rows" | "headerRow">;

/** The cells of a table in reading order, and which cell covers each place. */
export interface Grid {
  rows: number;
  cols: number;
  /** Row by row, left to right. */
  cells: readonly LaidCell[];
  /** The cell that covers a place; null outside the table or where no cell is laid. */
  at(row: number, col: number): LaidCell | null;
}

/** The grid of a table. */
export function gridOf(table: GridSource): Grid {
  const laid = layoutTable(table, 1, 1);
  const rows = laid.rows.length;
  const cols = laid.columns.length;
  const cells = laid.cells.flat();
  const owner = new Int32Array(rows * cols).fill(-1);
  cells.forEach((cell, index) => {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) owner[r * cols + c] = index;
    }
  });
  return {
    rows,
    cols,
    cells,
    at: (row, col) => {
      if (row < 0 || col < 0 || row >= rows || col >= cols) return null;
      const index = owner[row * cols + col] ?? -1;
      return index < 0 ? null : (cells[index] ?? null);
    },
  };
}

const clamp = (value: number, last: number): number => Math.min(Math.max(value, 0), Math.max(last, 0));

/** A place moved inside the grid. */
export const clampPlace = (grid: Grid, place: Place): Place => ({ row: clamp(place.row, grid.rows - 1), col: clamp(place.col, grid.cols - 1) });

/** The first place of the cell that covers a place; the place itself where nothing is laid. */
export function originOf(grid: Grid, place: Place): Place {
  const cell = grid.at(place.row, place.col);
  return cell ? { row: cell.row, col: cell.col } : place;
}

const same = (a: Place, b: Place): boolean => a.row === b.row && a.col === b.col;

/**
 * The block between two places, grown until it holds every merged cell it touches whole: picking half of a merged cell picks all of it,
 * and the cells the block then reaches may reach further, so it grows until it stops.
 */
export function rangeOf(grid: Grid, a: Place, b: Place): CellRange {
  const p = clampPlace(grid, a);
  const q = clampPlace(grid, b);
  let range: CellRange = { top: Math.min(p.row, q.row), left: Math.min(p.col, q.col), bottom: Math.max(p.row, q.row), right: Math.max(p.col, q.col) };
  for (let grown = true; grown; ) {
    grown = false;
    for (const cell of grid.cells) {
      const bottom = cell.row + cell.rowSpan - 1;
      const right = cell.col + cell.colSpan - 1;
      if (cell.row > range.bottom || bottom < range.top || cell.col > range.right || right < range.left) continue;
      const next = { top: Math.min(range.top, cell.row), left: Math.min(range.left, cell.col), bottom: Math.max(range.bottom, bottom), right: Math.max(range.right, right) };
      if (next.top !== range.top || next.left !== range.left || next.bottom !== range.bottom || next.right !== range.right) {
        range = next;
        grown = true;
      }
    }
  }
  return range;
}

/** The range a selection covers in `table`. */
export const rangeOfSelection = (table: GridSource, selection: Pick<CellSelection, "anchor" | "focus">): CellRange => rangeOf(gridOf(table), selection.anchor, selection.focus);

/** The cells inside a range, in reading order. A range made by `rangeOf` holds whole cells only. */
export function cellsIn(grid: Grid, range: CellRange): LaidCell[] {
  return grid.cells.filter((cell) => cell.row >= range.top && cell.row + cell.rowSpan - 1 <= range.bottom && cell.col >= range.left && cell.col + cell.colSpan - 1 <= range.right);
}

export const rowsIn = (range: CellRange): number => range.bottom - range.top + 1;
export const colsIn = (range: CellRange): number => range.right - range.left + 1;

/** Whether the range is one cell (a merged cell is one). */
export const isSingle = (grid: Grid, range: CellRange): boolean => cellsIn(grid, range).length === 1;

/** A selection of the one cell at a place. */
export const selectionAt = (table: string, place: Place): CellSelection => ({ table, anchor: place, focus: place });

/** The same range as a selection: its top left place to its bottom right. */
export const selectionOfRange = (table: string, range: CellRange): CellSelection => ({ table, anchor: { row: range.top, col: range.left }, focus: { row: range.bottom, col: range.right } });

/**
 * The selection moved one cell by an arrow key. The focus leaves the cell it is in (all of a merged cell) in the direction asked, keeping
 * its row or column; the anchor goes with it unless the key extends the pick. At an edge nothing moves, and the selection answered is the
 * one given.
 */
export function moveFocus(table: GridSource, selection: CellSelection, rows: number, cols: number, extend: boolean): CellSelection {
  const grid = gridOf(table);
  if (grid.rows === 0 || grid.cols === 0) return selection;
  const focus = clampPlace(grid, selection.focus);
  const cell = grid.at(focus.row, focus.col);
  const top = cell?.row ?? focus.row;
  const left = cell?.col ?? focus.col;
  const bottom = top + (cell?.rowSpan ?? 1) - 1;
  const right = left + (cell?.colSpan ?? 1) - 1;
  const next = clampPlace(grid, {
    row: rows > 0 ? bottom + rows : rows < 0 ? top + rows : focus.row,
    col: cols > 0 ? right + cols : cols < 0 ? left + cols : focus.col,
  });
  if (same(next, focus)) return selection;
  const landed = grid.at(next.row, next.col);
  // Landing in a merged cell is landing at its first place, so the next step off it starts from the cell and not from a corner.
  const to = extend ? next : landed ? { row: landed.row, col: landed.col } : next;
  const moved: CellSelection = { table: selection.table, anchor: extend ? selection.anchor : to, focus: to };
  // Pressing against the edge of a merged cell that reaches the edge of the table changes nothing.
  const was = rangeOf(grid, selection.anchor, selection.focus);
  const now = rangeOf(grid, moved.anchor, moved.focus);
  return was.top === now.top && was.left === now.left && was.bottom === now.bottom && was.right === now.right && (extend || same(originOf(grid, focus), to)) ? selection : moved;
}

/**
 * Where Tab goes from a place: the next cell in reading order, wrapping from the end of a row to the start of the next, or the cell before it
 * with Shift. `append` is Tab on the last cell, which makes a row and goes into it; Shift+Tab on the first cell stays where it is (null).
 */
export function tabTarget(table: GridSource, from: Place, back: boolean): Place | "append" | null {
  const grid = gridOf(table);
  const at = grid.at(from.row, from.col);
  const index = at ? grid.cells.indexOf(at) : -1;
  if (index < 0) return null;
  const next = grid.cells[index + (back ? -1 : 1)];
  if (next) return { row: next.row, col: next.col };
  return back ? null : "append";
}

/** The place below the cell at `from` (Enter commits and goes down); null on the last row. */
export function below(table: GridSource, from: Place): Place | null {
  const grid = gridOf(table);
  const at = grid.at(from.row, from.col);
  const row = (at?.row ?? from.row) + (at?.rowSpan ?? 1);
  if (row >= grid.rows) return null;
  const landed = grid.at(row, from.col);
  return landed ? { row: landed.row, col: landed.col } : { row, col: from.col };
}

/**
 * A selection kept inside a table that has changed (an undo, a delete): its places moved into the grid. Null when the table has no cells or the
 * selection is of another table.
 */
export function keepInside(table: GridSource & { id: string }, selection: CellSelection): CellSelection | null {
  if (selection.table !== table.id) return null;
  const grid = gridOf(table);
  if (grid.rows === 0 || grid.cols === 0) return null;
  const anchor = clampPlace(grid, selection.anchor);
  const focus = clampPlace(grid, selection.focus);
  return same(anchor, selection.anchor) && same(focus, selection.focus) ? selection : { table: selection.table, anchor, focus };
}

/**
 * The cells picked, as they stand after the deck changed: kept (moved into the table if it lost rows or columns) while the table is among
 * `scope` and is the one thing selected; dropped otherwise.
 */
export function cellsAfter(cells: CellSelection | null, selection: readonly string[], scope: readonly Element[]): CellSelection | null {
  if (!cells || selection.length !== 1 || selection[0] !== cells.table) return null;
  const table = scope.find((element) => element.id === cells.table);
  return table?.type === "table" ? keepInside(table, cells) : null;
}

/** Whether element `id`, wherever on the slide, is a table. */
export const isTableIn = (slide: Slide | undefined, id: string): boolean => (slide ? findElement(slide.elements, id)?.type === "table" : false);

/** Whether two selections pick the same places of the same table (as they were given, before growing over merged cells). */
export const sameSelection = (a: CellSelection | null, b: CellSelection | null): boolean => a === b || (a !== null && b !== null && a.table === b.table && same(a.anchor, b.anchor) && same(a.focus, b.focus));

/** The places of a range, row by row, as `[row, col]` pairs. */
export function placesIn(range: CellRange): Place[] {
  const out: Place[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) out.push({ row, col });
  }
  return out;
}
