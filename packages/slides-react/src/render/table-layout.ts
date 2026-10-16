// Where the cells of a table go. A table is drawn to fill its box: column
// widths and row heights are scaled to it, so a table that was resized
// without its columns being touched still fits its selection box.

import type { TableCell, TableEl } from "@kasten-slides/wasm";

export interface LaidCell {
  cell: TableCell;
  /** The first row and column the cell covers. */
  row: number;
  col: number;
  colSpan: number;
  rowSpan: number;
  /** The size of the area it covers, in slide units. */
  width: number;
  height: number;
  /** Whether it is in the header row. */
  header: boolean;
}

export interface TableLayout {
  columns: number[];
  rows: number[];
  /** The cells that fit, one list for each row of the table. */
  cells: LaidCell[][];
}

/** The most columns, rows and places (columns times rows) a table is drawn with: what the engine holds a table to. */
export const MOST_COLUMNS = 1000;
export const MOST_ROWS = 10_000;
export const MOST_PLACES = 50_000;

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** The sizes scaled to add up to `total`; equal shares when they have no size to go by. */
function scaled(sizes: readonly number[], total: number): number[] {
  const known = sum(sizes);
  if (known > 0) return known === total ? [...sizes] : sizes.map((size) => (size * total) / known);
  return sizes.map(() => total / Math.max(sizes.length, 1));
}

/** How many columns a table has, at most `MOST_COLUMNS`: the widths it lists, or failing those the widest row. A span is a number a file can make as big as it likes. */
function columnCount(table: Pick<TableEl, "columns" | "rows">): number {
  if (table.columns.length > 0) return Math.min(table.columns.length, MOST_COLUMNS);
  let widest = 0;
  for (const row of table.rows) widest = Math.max(widest, sum(row.cells.map((cell) => Math.max(1, cell.colSpan ?? 1))));
  return Math.min(widest, MOST_COLUMNS);
}

/**
 * Lays a table out in a box of `w` x `h`. Cells go where HTML puts them:
 * left to right in each row, skipping places a cell from a row above covers
 * with its `rowSpan`; a cell that would start past the last column is left out.
 */
export function layoutTable(table: Pick<TableEl, "columns" | "rows" | "headerRow">, w: number, h: number): TableLayout {
  const count = columnCount(table);
  // Rows beyond what the limits allow are not drawn: a table like that costs no more than the largest there may be.
  const shown = table.rows.slice(0, Math.min(MOST_ROWS, Math.floor(MOST_PLACES / Math.max(count, 1))));
  const columns = scaled(
    Array.from({ length: count }, (_, at) => Math.max(0, table.columns[at] ?? 0)),
    w,
  );

  const given = shown.map((row) => (row.height != null && row.height > 0 ? row.height : undefined));
  const unset = given.filter((height) => height === undefined).length;
  const left = h - sum(given.map((height) => height ?? 0));
  const share = unset > 0 ? Math.max(left / unset, 0) : 0;
  const rows = scaled(
    given.map((height) => height ?? share),
    h,
  );

  const taken = shown.map(() => new Array<boolean>(count).fill(false));
  const cells = shown.map((row, r): LaidCell[] => {
    const laid: LaidCell[] = [];
    let col = 0;
    for (const cell of row.cells) {
      while (col < count && taken[r]?.[col]) col++;
      if (col >= count) break;
      const colSpan = Math.min(Math.max(1, Math.floor(cell.colSpan ?? 1)), count - col);
      const rowSpan = Math.min(Math.max(1, Math.floor(cell.rowSpan ?? 1)), shown.length - r);
      for (let dr = 0; dr < rowSpan; dr++) taken[r + dr]?.fill(true, col, col + colSpan);
      laid.push({
        cell,
        row: r,
        col,
        colSpan,
        rowSpan,
        width: sum(columns.slice(col, col + colSpan)),
        height: sum(rows.slice(r, r + rowSpan)),
        header: Boolean(table.headerRow) && r === 0,
      });
      col += colSpan;
    }
    return laid;
  });
  return { columns, rows, cells };
}

/** One place of a table's grid: a row and a column, both from 0. */
export interface Place {
  row: number;
  col: number;
}

/** An area of a table in slide units, from the table's top left. */
export interface TableRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The track (a column or a row) that holds `at`. A line between two tracks belongs to the one after it. -1 when `at` is outside; with `clamp`, the nearest track. */
function trackAt(sizes: readonly number[], at: number, clamp: boolean): number {
  if (sizes.length === 0 || !Number.isFinite(at)) return -1;
  const total = sum(sizes);
  if (!clamp && (at < 0 || at > total)) return -1;
  if (at <= 0) return 0;
  let edge = 0;
  for (let i = 0; i < sizes.length; i++) {
    edge += sizes[i] ?? 0;
    if (at < edge) return i;
  }
  return sizes.length - 1;
}

/** The cell that covers a place (the whole merged cell for a place it spans); null when the place is not in the table or no cell is laid there. */
export function cellAt(layout: TableLayout, place: Place): LaidCell | null {
  if (place.row < 0 || place.col < 0 || place.row >= layout.cells.length) return null;
  for (let r = 0; r <= place.row; r++) {
    for (const laid of layout.cells[r] ?? []) {
      if (laid.row + laid.rowSpan > place.row && laid.col <= place.col && place.col < laid.col + laid.colSpan) return laid;
    }
  }
  return null;
}

/** The area the cell that covers `place` takes, from the table's top left; null where `cellAt` finds none. */
export function cellRect(layout: TableLayout, place: Place): TableRect | null {
  const laid = cellAt(layout, place);
  if (!laid) return null;
  return { x: sum(layout.columns.slice(0, laid.col)), y: sum(layout.rows.slice(0, laid.row)), w: laid.width, h: laid.height };
}

/**
 * The place under a point of the table, given in the table's own units from its top left: the first place of the cell there, so a merged
 * cell answers the same wherever in it the point is. Null for a point outside the table; with `clamp`, a point outside takes the nearest place
 * (a drag that has left the table).
 */
export function placeAt(layout: TableLayout, x: number, y: number, clamp = false): Place | null {
  const col = trackAt(layout.columns, x, clamp);
  const row = trackAt(layout.rows, y, clamp);
  if (col < 0 || row < 0) return null;
  const laid = cellAt(layout, { row, col });
  return laid ? { row: laid.row, col: laid.col } : { row, col };
}
