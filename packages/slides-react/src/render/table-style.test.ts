import { describe, expect, it } from "vitest";

import { TABLE_STYLES, cellLook } from "./table-style.ts";

const style = (preset: string, more: { bandedRows?: boolean; firstColumn?: boolean; lastRow?: boolean } = {}) => ({ preset, bandedRows: true, ...more });

// The same cells as the tests of `table_style.rs` check, so the editor and the export agree.
describe("the table styles", () => {
  it("are ten, each with a label", () => {
    expect(TABLE_STYLES).toHaveLength(10);
    expect(TABLE_STYLES.every((p) => p.label !== "")).toBe(true);
  });

  it("give the header the accent and shade every other row after it", () => {
    const s = style("accent");
    const header = cellLook(s, true, 4, 2, 0, 0);
    expect(header.fill).toEqual({ color: "accent1" });
    expect(header.text).toBe("bg1");
    expect(header.bold).toBe(true);
    expect(cellLook(s, true, 4, 2, 1, 1).fill).toBeUndefined();
    expect(cellLook(s, true, 4, 2, 2, 1).fill).toEqual({ color: "accent1", alpha: 0.1 });
    expect(cellLook(s, true, 4, 2, 3, 1).fill).toBeUndefined();
  });

  it("treat the first row as data when the table has no header row", () => {
    const s = style("accent");
    expect(cellLook(s, false, 3, 2, 0, 0).fill).toBeUndefined();
    expect(cellLook(s, false, 3, 2, 0, 0).bold).toBe(false);
    expect(cellLook(s, false, 3, 2, 1, 0).fill).toBeDefined();
  });

  it("set the first column and the last row apart when asked", () => {
    const off = style("grid", { bandedRows: false });
    expect(cellLook(off, true, 3, 3, 1, 0).bold).toBe(false);
    const on = style("grid", { bandedRows: false, firstColumn: true, lastRow: true });
    expect(cellLook(on, true, 3, 3, 1, 0).bold).toBe(true);
    expect(cellLook(on, true, 3, 3, 2, 2).bold).toBe(true);
    expect(cellLook(on, true, 3, 3, 1, 1).bold).toBe(false);
  });

  it("draw the outline only on the edges of the table", () => {
    const s = style("outline");
    const inner = cellLook(s, false, 3, 3, 1, 1);
    expect(inner.top ?? inner.left).toBeUndefined();
    const corner = cellLook(s, false, 3, 3, 0, 0);
    expect(corner.top).toBeDefined();
    expect(corner.left).toBeDefined();
    expect(corner.right ?? corner.bottom).toBeUndefined();
  });

  it("draw an unknown style as the first", () => {
    expect(cellLook(style("nonsense"), true, 3, 3, 1, 1)).toEqual(cellLook(style("grid"), true, 3, 3, 1, 1));
  });
});
