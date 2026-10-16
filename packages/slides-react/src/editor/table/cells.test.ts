// @vitest-environment node

import type { TableCell, TableRow } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { below, cellsIn, clampPlace, gridOf, isSingle, keepInside, moveFocus, originOf, placesIn, rangeOf, rangeOfSelection, selectionAt, sameSelection, tabTarget, type CellSelection } from "./cells.ts";

const cell = (extra: Partial<TableCell> = {}): TableCell => ({ text: { paragraphs: [] }, ...extra });
const row = (...cells: TableCell[]): TableRow => ({ cells });

/**
 *   0 1 2 3
 * 0 a a b c        a is one cell over columns 0-1
 * 1 d e b f        b is one cell over rows 0-1 of column 2
 * 2 g g g g        g is one cell over the whole row
 * 3 h i j k
 */
const table = {
  id: "t",
  columns: [10, 10, 10, 10],
  rows: [row(cell({ colSpan: 2 }), cell({ rowSpan: 2 }), cell()), row(cell(), cell(), cell()), row(cell({ colSpan: 4 })), row(cell(), cell(), cell(), cell())],
};

const at = (row: number, col: number) => ({ row, col });
const range = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });

describe("the grid of a table", () => {
  const grid = gridOf(table);

  it("knows its size and lists the cells in reading order", () => {
    expect([grid.rows, grid.cols]).toEqual([4, 4]);
    expect(grid.cells.map((c) => [c.row, c.col])).toEqual([[0, 0], [0, 2], [0, 3], [1, 0], [1, 1], [1, 3], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3]]);
  });

  it("finds the cell that covers a place, a merged one from any of its places", () => {
    expect(grid.at(0, 1)).toMatchObject({ row: 0, col: 0, colSpan: 2 });
    expect(grid.at(1, 2)).toMatchObject({ row: 0, col: 2, rowSpan: 2 });
    expect(grid.at(2, 3)).toMatchObject({ row: 2, col: 0, colSpan: 4 });
    expect(grid.at(4, 0)).toBeNull();
    expect(grid.at(0, -1)).toBeNull();
  });

  it("gives the first place of a cell, and keeps a place no cell covers", () => {
    expect(originOf(grid, at(2, 3))).toEqual(at(2, 0));
    expect(originOf(grid, at(1, 1))).toEqual(at(1, 1));
    expect(originOf(grid, at(9, 9))).toEqual(at(9, 9));
  });

  it("moves a place into the table", () => {
    expect(clampPlace(grid, at(-3, 9))).toEqual(at(0, 3));
    expect(clampPlace(grid, at(9, -1))).toEqual(at(3, 0));
  });

  it("is empty for a table with nothing in it", () => {
    const none = gridOf({ columns: [], rows: [] });
    expect([none.rows, none.cols, none.cells.length]).toEqual([0, 0, 0]);
    expect(none.at(0, 0)).toBeNull();
  });
});

describe("a range of cells", () => {
  const grid = gridOf(table);

  it("is the block between two places, whichever corner each is", () => {
    expect(rangeOf(grid, at(1, 0), at(1, 1))).toEqual(range(1, 0, 1, 1));
    expect(rangeOf(grid, at(3, 3), at(3, 0))).toEqual(range(3, 0, 3, 3));
  });

  it("takes a merged cell whole when the block cuts it", () => {
    // Column 1 of row 0 is half of the cell over columns 0-1; row 1 of column 2 is half of the cell over rows 0-1.
    expect(rangeOf(grid, at(0, 1), at(0, 1))).toEqual(range(0, 0, 0, 1));
    expect(rangeOf(grid, at(1, 2), at(1, 2))).toEqual(range(0, 2, 1, 2));
  });

  it("goes on growing while the cells it reaches reach further", () => {
    // Place (1,1) to (1,2): the tall cell b adds row 0, and row 0 holds the wide cell a, which adds column 0.
    expect(rangeOf(grid, at(1, 1), at(1, 2))).toEqual(range(0, 0, 1, 2));
  });

  it("takes the whole row for a cell that spans it, and what that reaches", () => {
    expect(rangeOf(grid, at(2, 1), at(2, 1))).toEqual(range(2, 0, 2, 3));
    // Column 3 from row 1 down meets the wide cell, which meets the tall cell b in row 1, which reaches up to row 0.
    expect(rangeOf(grid, at(1, 3), at(3, 3))).toEqual(range(0, 0, 3, 3));
  });

  it("holds only whole cells, and says how many", () => {
    const wide = rangeOf(grid, at(0, 0), at(1, 2));
    expect(cellsIn(grid, wide).map((c) => [c.row, c.col])).toEqual([[0, 0], [0, 2], [1, 0], [1, 1]]);
    expect(isSingle(grid, rangeOf(grid, at(0, 1), at(0, 1)))).toBe(true);
    expect(isSingle(grid, wide)).toBe(false);
  });

  it("keeps a place outside the table inside it", () => {
    expect(rangeOf(grid, at(-4, -4), at(40, 40))).toEqual(range(0, 0, 3, 3));
  });

  it("is read from a selection of a table", () => {
    expect(rangeOfSelection(table, { anchor: at(3, 0), focus: at(3, 1) })).toEqual(range(3, 0, 3, 1));
  });

  it("lists its places row by row", () => {
    expect(placesIn(range(1, 1, 2, 2))).toEqual([at(1, 1), at(1, 2), at(2, 1), at(2, 2)]);
  });
});

describe("moving the picked cell with the arrow keys", () => {
  const one = (r: number, c: number): CellSelection => selectionAt("t", at(r, c));

  it("moves by a cell, and takes the anchor along", () => {
    expect(moveFocus(table, one(3, 1), 0, 1, false)).toEqual(one(3, 2));
    expect(moveFocus(table, one(3, 1), 0, -1, false)).toEqual(one(3, 0));
    expect(moveFocus(table, one(1, 0), 1, 0, false)).toEqual(one(2, 0));
    expect(moveFocus(table, one(1, 0), -1, 0, false)).toEqual(one(0, 0));
  });

  it("goes over a merged cell as one step, from either side", () => {
    // From b (rows 0-1 of column 2), down lands under it, left lands next to it.
    expect(moveFocus(table, one(0, 2), 1, 0, false)).toEqual(one(2, 0));
    expect(moveFocus(table, one(1, 2), 0, -1, false)).toEqual(one(1, 1));
    // From a (columns 0-1 of row 0), right lands on b.
    expect(moveFocus(table, one(0, 1), 0, 1, false)).toEqual(one(0, 2));
    // Up from the wide cell lands on the cell above the column the focus was in.
    expect(moveFocus(table, one(2, 3), -1, 0, false)).toEqual(one(1, 3));
  });

  it("leaves the selection as it is at an edge", () => {
    const first = one(0, 0);
    expect(moveFocus(table, first, -1, 0, false)).toBe(first);
    expect(moveFocus(table, first, 0, -1, true)).toBe(first);
    const last = one(3, 3);
    expect(moveFocus(table, last, 1, 0, false)).toBe(last);
    expect(moveFocus(table, last, 0, 1, true)).toBe(last);
    // The wide cell reaches both sides: it cannot go sideways.
    const wide = one(2, 1);
    expect(moveFocus(table, wide, 0, 1, false)).toBe(wide);
  });

  it("extends from the anchor with Shift", () => {
    const start = one(3, 0);
    const down = moveFocus(table, start, -1, 0, true);
    expect(down).toEqual({ table: "t", anchor: at(3, 0), focus: at(2, 0) });
    // Row 2 is one cell over the whole row, so the pick grows to all of it.
    expect(rangeOfSelection(table, down)).toEqual(range(2, 0, 3, 3));
    const more = moveFocus(table, down, -1, 0, true);
    expect(more.anchor).toEqual(at(3, 0));
    expect(more.focus).toEqual(at(1, 0));
    // Row 1 holds the tall cell b, which reaches up to row 0.
    expect(rangeOfSelection(table, more)).toEqual(range(0, 0, 3, 3));
  });

  it("collapses a range to one cell when it moves without Shift", () => {
    const picked: CellSelection = { table: "t", anchor: at(3, 0), focus: at(3, 2) };
    expect(moveFocus(table, picked, 0, 1, false)).toEqual(one(3, 3));
  });

  it("does nothing for a table with nothing in it", () => {
    const empty = { columns: [], rows: [] };
    const given = one(0, 0);
    expect(moveFocus(empty, given, 1, 0, false)).toBe(given);
  });
});

describe("Tab", () => {
  it("goes to the next cell, and wraps from the end of a row to the start of the next", () => {
    expect(tabTarget(table, at(3, 0), false)).toEqual(at(3, 1));
    expect(tabTarget(table, at(0, 3), false)).toEqual(at(1, 0));
    expect(tabTarget(table, at(1, 3), false)).toEqual(at(2, 0));
  });

  it("skips the places a merged cell covers", () => {
    // After the wide cell a (columns 0-1) comes b, not column 1; after e comes f, not the covered place under b.
    expect(tabTarget(table, at(0, 0), false)).toEqual(at(0, 2));
    expect(tabTarget(table, at(0, 1), false)).toEqual(at(0, 2));
    expect(tabTarget(table, at(1, 1), false)).toEqual(at(1, 3));
  });

  it("goes back with Shift, wrapping the other way, and stays on the first cell", () => {
    expect(tabTarget(table, at(3, 1), true)).toEqual(at(3, 0));
    expect(tabTarget(table, at(1, 0), true)).toEqual(at(0, 3));
    expect(tabTarget(table, at(2, 0), true)).toEqual(at(1, 3));
    expect(tabTarget(table, at(0, 0), true)).toBeNull();
  });

  it("asks for a new row on the last cell, which Shift does not", () => {
    expect(tabTarget(table, at(3, 3), false)).toBe("append");
    expect(tabTarget(table, at(3, 3), true)).toEqual(at(3, 2));
  });

  it("answers nothing for a place outside the table", () => {
    expect(tabTarget(table, at(9, 9), false)).toBeNull();
  });
});

describe("Enter", () => {
  it("goes to the cell below, under a merged cell's last row", () => {
    expect(below(table, at(0, 0))).toEqual(at(1, 0));
    expect(below(table, at(0, 2))).toEqual(at(2, 0));
    expect(below(table, at(2, 1))).toEqual(at(3, 1));
  });

  it("stays on the last row", () => {
    expect(below(table, at(3, 2))).toBeNull();
    expect(below(table, at(2, 0))).toEqual(at(3, 0));
  });
});

describe("a selection after the table changed", () => {
  it("is kept when it still fits", () => {
    const given = selectionAt("t", at(2, 2));
    expect(keepInside(table, given)).toBe(given);
  });

  it("is moved into the table when rows or columns went", () => {
    expect(keepInside({ ...table, rows: table.rows.slice(0, 2) }, { table: "t", anchor: at(3, 0), focus: at(3, 3) })).toEqual({ table: "t", anchor: at(1, 0), focus: at(1, 3) });
  });

  it("is dropped for another table or a table with nothing in it", () => {
    expect(keepInside(table, selectionAt("other", at(0, 0)))).toBeNull();
    expect(keepInside({ id: "t", columns: [], rows: [] }, selectionAt("t", at(0, 0)))).toBeNull();
  });

  it("compares by the places picked", () => {
    expect(sameSelection(selectionAt("t", at(1, 1)), selectionAt("t", at(1, 1)))).toBe(true);
    expect(sameSelection(selectionAt("t", at(1, 1)), selectionAt("t", at(1, 2)))).toBe(false);
    expect(sameSelection(selectionAt("t", at(1, 1)), null)).toBe(false);
    expect(sameSelection(null, null)).toBe(true);
  });
});
