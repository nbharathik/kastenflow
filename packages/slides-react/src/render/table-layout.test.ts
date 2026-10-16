// @vitest-environment node

import type { TableCell, TableRow } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { cellAt, cellRect, layoutTable, MOST_COLUMNS, MOST_PLACES, MOST_ROWS, placeAt } from "./table-layout.ts";

const cell = (extra: Partial<TableCell> = {}): TableCell => ({ text: { paragraphs: [] }, ...extra });
const row = (cells: TableCell[], height?: number): TableRow => ({ cells, ...(height === undefined ? {} : { height }) });
const at = (layout: ReturnType<typeof layoutTable>) => layout.cells.map((cells) => cells.map((c) => [c.row, c.col, c.colSpan, c.rowSpan]));

describe("layoutTable", () => {
  it("uses the column widths, and an equal share of the box for each row", () => {
    const layout = layoutTable({ columns: [200, 200], rows: [row([cell(), cell()]), row([cell(), cell()])] }, 400, 90);
    expect(layout.columns).toEqual([200, 200]);
    expect(layout.rows).toEqual([45, 45]);
    expect(layout.cells[0]?.map((c) => [c.width, c.height])).toEqual([
      [200, 45],
      [200, 45],
    ]);
  });

  it("scales the columns and the rows to the box, so a resized table still fills it", () => {
    const layout = layoutTable({ columns: [100, 300], rows: [row([cell(), cell()], 20), row([cell(), cell()], 60)] }, 200, 160);
    expect(layout.columns).toEqual([50, 150]);
    expect(layout.rows).toEqual([40, 120]);
  });

  it("gives the rows without a height what the others leave", () => {
    const layout = layoutTable({ columns: [100], rows: [row([cell()], 20), row([cell()]), row([cell()])] }, 100, 100);
    expect(layout.rows).toEqual([20, 40, 40]);
  });

  it("shares the box equally when the sizes are all zero", () => {
    const layout = layoutTable({ columns: [0, 0], rows: [row([cell(), cell()], 0), row([cell(), cell()])] }, 100, 50);
    expect(layout.columns).toEqual([50, 50]);
    expect(layout.rows).toEqual([25, 25]);
  });

  it("finds the columns from the widest row when no widths are listed", () => {
    const layout = layoutTable({ columns: [], rows: [row([cell(), cell(), cell()]), row([cell({ colSpan: 2 })])] }, 300, 60);
    expect(layout.columns).toEqual([100, 100, 100]);
  });

  it("places cells the way HTML does, and sums the sizes of what a cell covers", () => {
    const layout = layoutTable(
      {
        columns: [100, 100, 100],
        rows: [
          row([cell({ colSpan: 2 }), cell({ rowSpan: 2 })], 30),
          row([cell(), cell()], 30),
          row([cell(), cell(), cell()], 40),
        ],
      },
      300,
      100,
    );
    expect(at(layout)).toEqual([
      [
        [0, 0, 2, 1],
        [0, 2, 1, 2],
      ],
      [
        [1, 0, 1, 1],
        [1, 1, 1, 1],
      ],
      [
        [2, 0, 1, 1],
        [2, 1, 1, 1],
        [2, 2, 1, 1],
      ],
    ]);
    expect(layout.cells[0]?.map((c) => [c.width, c.height])).toEqual([
      [200, 30],
      [100, 60],
    ]);
  });

  it("keeps a span inside the table, and leaves out a cell past the last column", () => {
    const layout = layoutTable({ columns: [50, 50], rows: [row([cell({ colSpan: 5 }), cell()]), row([cell({ rowSpan: 9 }), cell(), cell()])] }, 100, 40);
    expect(at(layout)).toEqual([[[0, 0, 2, 1]], [[1, 0, 1, 1], [1, 1, 1, 1]]]);
  });

  it("marks the first row as the header only when the table has one", () => {
    const rows = [row([cell()]), row([cell()])];
    expect(layoutTable({ columns: [10], rows, headerRow: true }, 10, 10).cells.map((cells) => cells.map((c) => c.header))).toEqual([[true], [false]]);
    expect(layoutTable({ columns: [10], rows }, 10, 10).cells.map((cells) => cells.map((c) => c.header))).toEqual([[false], [false]]);
  });

  it("counts a span of four billion columns as the widest table there may be, and lays it out at once", () => {
    const started = Date.now();
    const layout = layoutTable({ columns: [], rows: [row([cell({ colSpan: 4294967295 }), cell({ colSpan: 4294967295 })])] }, 1000, 40);
    expect(layout.columns).toHaveLength(MOST_COLUMNS);
    expect(at(layout)).toEqual([[[0, 0, MOST_COLUMNS, 1]]]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("draws no more rows than the limits allow, so a table of a hundred thousand rows costs no more than the largest there may be", () => {
    const rows = (count: number) => Array.from({ length: count }, () => row([cell()]));
    expect(layoutTable({ columns: [10], rows: rows(100_000) }, 10, 10).rows).toHaveLength(MOST_ROWS);
    expect(layoutTable({ columns: new Array<number>(MOST_COLUMNS).fill(1), rows: rows(1000) }, 10, 10).rows).toHaveLength(MOST_PLACES / MOST_COLUMNS);
    expect(layoutTable({ columns: [1, 1], rows: rows(3) }, 10, 10).rows).toHaveLength(3);
  });

  it("lays out a table with nothing in it", () => {
    expect(layoutTable({ columns: [], rows: [] }, 100, 100)).toEqual({ columns: [], rows: [], cells: [] });
  });
});

/** A 3 x 3 table, 300 x 90, with a cell over the first two columns of row 0 and one over rows 1 and 2 of column 2. */
const merged = () =>
  layoutTable(
    {
      columns: [100, 100, 100],
      rows: [row([cell({ colSpan: 2 }), cell()], 20), row([cell(), cell(), cell({ rowSpan: 2 })], 30), row([cell(), cell()], 40)],
    },
    300,
    90,
  );

describe("placeAt", () => {
  it("finds the place under a point, in the table's own units", () => {
    const layout = merged();
    expect(placeAt(layout, 10, 5)).toEqual({ row: 0, col: 0 });
    expect(placeAt(layout, 250, 5)).toEqual({ row: 0, col: 2 });
    expect(placeAt(layout, 150, 25)).toEqual({ row: 1, col: 1 });
    expect(placeAt(layout, 10, 80)).toEqual({ row: 2, col: 0 });
  });

  it("answers a point on a line between cells with the cell after it, as a pointer pressed there would pick", () => {
    const layout = merged();
    expect(placeAt(layout, 100, 5)).toEqual({ row: 0, col: 0 });
    expect(placeAt(layout, 150, 20)).toEqual({ row: 1, col: 1 });
  });

  it("answers the first place of a merged cell wherever in it the point is", () => {
    const layout = merged();
    expect(placeAt(layout, 150, 5)).toEqual({ row: 0, col: 0 });
    expect(placeAt(layout, 99, 19)).toEqual({ row: 0, col: 0 });
    expect(placeAt(layout, 250, 80)).toEqual({ row: 1, col: 2 });
    expect(placeAt(layout, 250, 40)).toEqual({ row: 1, col: 2 });
  });

  it("takes the far edges as inside, and anything past them as outside", () => {
    const layout = merged();
    expect(placeAt(layout, 300, 90)).toEqual({ row: 1, col: 2 });
    expect(placeAt(layout, 150, 90)).toEqual({ row: 2, col: 1 });
    expect(placeAt(layout, 0, 0)).toEqual({ row: 0, col: 0 });
    expect(placeAt(layout, -1, 10)).toBeNull();
    expect(placeAt(layout, 10, -0.5)).toBeNull();
    expect(placeAt(layout, 301, 10)).toBeNull();
    expect(placeAt(layout, 10, 91)).toBeNull();
  });

  it("clamps to the table when asked to, for a drag that leaves it", () => {
    const layout = merged();
    expect(placeAt(layout, -50, -50, true)).toEqual({ row: 0, col: 0 });
    expect(placeAt(layout, 900, 900, true)).toEqual({ row: 1, col: 2 });
    expect(placeAt(layout, 150, 900, true)).toEqual({ row: 2, col: 1 });
  });

  it("answers nothing for a table with nothing in it", () => {
    expect(placeAt(layoutTable({ columns: [], rows: [] }, 100, 100), 10, 10)).toBeNull();
    expect(placeAt(layoutTable({ columns: [], rows: [] }, 100, 100), 10, 10, true)).toBeNull();
  });
});

describe("cellRect and cellAt", () => {
  it("gives the area a cell covers, from the table's top left", () => {
    const layout = merged();
    expect(cellRect(layout, { row: 0, col: 0 })).toEqual({ x: 0, y: 0, w: 200, h: 20 });
    expect(cellRect(layout, { row: 1, col: 2 })).toEqual({ x: 200, y: 20, w: 100, h: 70 });
    expect(cellRect(layout, { row: 2, col: 1 })).toEqual({ x: 100, y: 50, w: 100, h: 40 });
  });

  it("gives the whole merged cell for a place it covers", () => {
    const layout = merged();
    expect(cellRect(layout, { row: 0, col: 1 })).toEqual({ x: 0, y: 0, w: 200, h: 20 });
    expect(cellRect(layout, { row: 2, col: 2 })).toEqual({ x: 200, y: 20, w: 100, h: 70 });
  });

  it("finds the laid cell that covers a place, and none for a place outside the table", () => {
    const layout = merged();
    expect(cellAt(layout, { row: 0, col: 1 })).toMatchObject({ row: 0, col: 0, colSpan: 2 });
    expect(cellAt(layout, { row: 2, col: 2 })).toMatchObject({ row: 1, col: 2, rowSpan: 2 });
    expect(cellAt(layout, { row: 3, col: 0 })).toBeNull();
    expect(cellAt(layout, { row: 0, col: -1 })).toBeNull();
    expect(cellRect(layout, { row: 5, col: 5 })).toBeNull();
  });
});
