import type { Theme } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { cellBorders } from "./table-borders.ts";
import { cellLook } from "./table-style.ts";

const theme = { colors: { text1: "#111111", text2: "#555555", bg1: "#ffffff", bg2: "#eeeeee", accent1: "#0b5cad" } } as unknown as Theme;

describe("a cell's lines", () => {
  it("are left to the stylesheet's grid when the cell has neither a style nor lines of its own", () => {
    expect(cellBorders(theme, undefined, undefined)).toEqual({});
  });

  it("follow the table style, and a style that names no line draws none", () => {
    const outline = { preset: "outline", bandedRows: false };
    const inner = cellBorders(theme, cellLook(outline, false, 3, 3, 1, 1), undefined);
    expect(inner).toMatchObject({ borderTopStyle: "none", borderLeftStyle: "none" });
    const corner = cellBorders(theme, cellLook(outline, false, 3, 3, 0, 0), undefined);
    expect(corner).toMatchObject({ borderTopStyle: "solid", borderTopWidth: "1.5px", borderBottomStyle: "none" });
  });

  it("are the cell's own where it has them, and a width of 0 is no line", () => {
    const look = cellLook({ preset: "grid", bandedRows: false }, false, 2, 2, 0, 0);
    const out = cellBorders(theme, look, { top: { color: "accent1", width: 3 }, left: { color: "text1", width: 0 } });
    expect(out).toMatchObject({ borderTopWidth: "3px", borderLeftStyle: "none", borderRightStyle: "solid" });
  });

  it("keep the plain grid colour on the sides a cell with only some lines of its own does not name", () => {
    const out = cellBorders(theme, undefined, { top: { color: "accent1", width: 2 } });
    expect(out).toMatchObject({ borderTopWidth: "2px" });
    expect(out).toHaveProperty("borderRightColor");
    expect(out).not.toHaveProperty("borderRightStyle");
  });
});
