import { describe, expect, it } from "vitest";

import { GREYS, HUES, HUE_SHADES, hexToHsv, hexToRgb, hsvToHex, moveInGrid, normalHex, rgbToHex, shade, standardRows } from "./color-math.ts";

describe("hex values", () => {
  it("are written as six lower-case digits, whether given as three or six, with the hash or without", () => {
    expect(normalHex("#ABC")).toBe("#aabbcc");
    expect(normalHex("1A73E8")).toBe("#1a73e8");
    expect(normalHex("  #00ff00 ")).toBe("#00ff00");
  });

  it("are refused when they are not colours", () => {
    for (const bad of ["", "#12", "#12345", "#1234567", "red", "#ggg", "accent1"]) expect(normalHex(bad), bad).toBeNull();
  });

  it("go to red, green and blue and back", () => {
    expect(hexToRgb("#1a73e8")).toEqual({ r: 26, g: 115, b: 232 });
    expect(rgbToHex({ r: 26, g: 115, b: 232 })).toBe("#1a73e8");
    expect(rgbToHex({ r: 300, g: -4, b: 12.4 })).toBe("#ff000c");
  });
});

describe("hue, saturation and value", () => {
  it("name the primary colours", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00").h).toBe(120);
    expect(hexToHsv("#0000ff").h).toBe(240);
    expect(hexToHsv("#ffffff")).toEqual({ h: 0, s: 0, v: 1 });
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("come back as the same colour for any colour of the palette", () => {
    for (const hex of [...GREYS, ...HUES, ...standardRows().flat()]) expect(hsvToHex(hexToHsv(hex)), hex).toBe(hex);
  });

  it("keep the hue when the colour is moved, even to grey, because the caller holds it", () => {
    expect(hsvToHex({ h: 240, s: 0, v: 0.5 })).toBe("#808080");
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe("#ff0000");
    expect(hsvToHex({ h: -120, s: 1, v: 1 })).toBe("#0000ff");
  });
});

describe("shades", () => {
  it("mix toward white for a positive amount and toward black for a negative one", () => {
    expect(shade("#ff0000", 0.5)).toBe("#ff8080");
    expect(shade("#ff0000", -0.5)).toBe("#800000");
    expect(shade("#336699", 0)).toBe("#336699");
    expect(shade("#336699", 1)).toBe("#ffffff");
    expect(shade("#336699", -1)).toBe("#000000");
  });
});

describe("the standard palette", () => {
  it("has the greys, the hues and a row for each shade, ten colours across", () => {
    const rows = standardRows();
    expect(rows.length).toBe(2 + HUE_SHADES.length);
    expect(rows.every((row) => row.length === 10)).toBe(true);
    expect(rows[0]![0]).toBe("#000000");
    expect(rows[0]![9]).toBe("#ffffff");
    expect(rows[1]).toEqual([...HUES]);
  });

  it("has no colour twice, so a swatch can be found by its hex value", () => {
    const all = standardRows().flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("moving over a grid of swatches with the keys", () => {
  const rows = [10, 10, 4];

  it("goes by one in each direction, and stops at the edges of the grid", () => {
    expect(moveInGrid(rows, { row: 0, col: 3 }, "ArrowRight")).toEqual({ row: 0, col: 4 });
    expect(moveInGrid(rows, { row: 1, col: 3 }, "ArrowUp")).toEqual({ row: 0, col: 3 });
    expect(moveInGrid(rows, { row: 0, col: 3 }, "ArrowUp")).toEqual({ row: 0, col: 3 });
    expect(moveInGrid(rows, { row: 2, col: 1 }, "ArrowDown")).toEqual({ row: 2, col: 1 });
  });

  it("goes on to the next row at the end of a row, and back to the one before at the start", () => {
    expect(moveInGrid(rows, { row: 0, col: 9 }, "ArrowRight")).toEqual({ row: 1, col: 0 });
    expect(moveInGrid(rows, { row: 1, col: 0 }, "ArrowLeft")).toEqual({ row: 0, col: 9 });
  });

  it("stays in a column that a shorter row lacks by going to the last swatch of that row", () => {
    expect(moveInGrid(rows, { row: 1, col: 8 }, "ArrowDown")).toEqual({ row: 2, col: 3 });
  });

  it("goes to the start and end of a row with Home and End, and ignores other keys", () => {
    expect(moveInGrid(rows, { row: 1, col: 5 }, "Home")).toEqual({ row: 1, col: 0 });
    expect(moveInGrid(rows, { row: 1, col: 5 }, "End")).toEqual({ row: 1, col: 9 });
    expect(moveInGrid(rows, { row: 1, col: 5 }, "a")).toBeNull();
  });
});
