// A table edit writes only the lines and cells it changes. "Canonical" below is
// what the editor's serializer would write for the edited table (every cell
// padded); the patch must say the same thing in the original's own bytes.

import { describe, expect, it } from "vitest";

import { alignOf, delimiterCell, isDelimiterRow, splitRow } from "./cells";
import { patchTable } from "./patch";

const lines = (...l: string[]) => l.join("\n");

describe("reading a table line", () => {
  it("finds each cell's bytes", () => {
    const line = "| a  | b\\|c |  |";
    const row = splitRow(line);
    expect(row.leading).toBe(true);
    expect(row.trailing).toBe(true);
    expect(row.cells.map((c) => c.text)).toEqual(["a", "b\\|c", ""]);
    expect(line.slice(row.cells[0]!.start, row.cells[0]!.end)).toBe(" a  ");
  });

  it("reads lines with no outer pipes", () => {
    const row = splitRow("Name | Value");
    expect([row.leading, row.trailing, row.cells.map((c) => c.text)]).toEqual([false, false, ["Name", "Value"]]);
  });

  it("knows delimiter cells and their alignment", () => {
    expect(["---", ":--", "--:", ":-:", "-"].map(alignOf)).toEqual([null, "left", "right", "center", null]);
    expect(alignOf("a")).toBeUndefined();
    expect(alignOf("::")).toBeUndefined();
    expect(isDelimiterRow("|:---:|---|")).toBe(true);
    expect(isDelimiterRow("| a | b |")).toBe(false);
  });

  it("writes delimiter cells of the width asked", () => {
    expect([delimiterCell("center", 3), delimiterCell("left", 6), delimiterCell("right", 4), delimiterCell(null, 5), delimiterCell("center", 1)]).toEqual([":-:", ":-----", "---:", "-----", ":-:"]);
  });
});

describe("changing alignment", () => {
  it("rewrites the delimiter cell and no other byte", () => {
    const original = lines("| Name | Qty |", "| --- | --- |", "| a | 1 |");
    const canonical = lines("| Name | Qty |", "| ---- | :-: |", "| a    | 1   |");
    expect(patchTable(original, canonical)).toBe(lines("| Name | Qty |", "| --- | :-: |", "| a | 1 |"));
  });

  it("keeps a hand-spaced table, writing `---:` as wide as `:-----` was", () => {
    const original = lines("| Left | Center | Right |", "|:-----|:------:|------:|", "| a    |   b    |     c |", "| `code` | **bold** | [link](https://example.com) |");
    const canonical = lines("| Left | Center | Right |", "| ---: | :----: | ----: |", "| a    | b      | c     |", "| `code` | **bold** | [link](https://example.com) |");
    const got = patchTable(original, canonical);
    expect(got).toBe(lines("| Left | Center | Right |", "|-----:|:------:|------:|", "| a    |   b    |     c |", "| `code` | **bold** | [link](https://example.com) |"));
  });

  it("works on a table with no outer pipes", () => {
    const original = lines("Name | Value", "--- | ---", "no outer pipes | 42");
    const canonical = lines("| Name | Value |", "| ---- | :---: |", "| no outer pipes | 42 |");
    expect(patchTable(original, canonical)).toBe(lines("Name | Value", "--- | :-:", "no outer pipes | 42"));
  });

  it("changes nothing when nothing changed", () => {
    const original = lines("|Name|Qty|", "|:--|--:|", "|a|1|");
    expect(patchTable(original, lines("| Name | Qty |", "| :-- | --: |", "| a | 1 |"))).toBe(original);
  });

  it("clears an alignment", () => {
    const original = lines("| a | b |", "|:-:|:--|", "| 1 | 2 |");
    expect(patchTable(original, lines("| a | b |", "| :-: | - |", "| 1 | 2 |"))).toBe(lines("| a | b |", "|:-:|---|", "| 1 | 2 |"));
  });
});

describe("rows and columns", () => {
  const original = lines("| A   | B |", "| --- | --- |", "| 1   | 2 |", "| 3 | 4 |");

  it("adds a row as one new line", () => {
    const canonical = lines("| A | B |", "| - | - |", "| 1 | 2 |", "| 3 | 4 |", "| 5 | 6 |");
    expect(patchTable(original, canonical)).toBe(`${original}\n| 5 | 6 |`);
  });

  it("adds a row in the middle", () => {
    const canonical = lines("| A | B |", "| - | - |", "| 1 | 2 |", "|   |   |", "| 3 | 4 |");
    expect(patchTable(original, canonical)).toBe(lines("| A   | B |", "| --- | --- |", "| 1   | 2 |", "|  |  |", "| 3 | 4 |"));
  });

  it("removes a row by dropping its line", () => {
    const canonical = lines("| A | B |", "| - | - |", "| 3 | 4 |");
    expect(patchTable(original, canonical)).toBe(lines("| A   | B |", "| --- | --- |", "| 3 | 4 |"));
  });

  it("adds a column at the end of every line", () => {
    const canonical = lines("| A | B | C |", "| - | - | :-: |", "| 1 | 2 | x |", "| 3 | 4 |   |");
    expect(patchTable(original, canonical)).toBe(lines("| A   | B | C |", "| --- | --- | :-: |", "| 1   | 2 | x |", "| 3 | 4 |  |"));
  });

  it("adds a column to a table with no outer pipes", () => {
    const canonical = lines("| A | B | C |", "| - | - | - |", "| 1 | 2 | 3 |");
    expect(patchTable(lines("A | B", "- | -", "1 | 2"), canonical)).toBe(lines("A | B | C", "- | - | ---", "1 | 2 | 3"));
  });

  it("removes the last column by cutting each line", () => {
    const canonical = lines("| A |", "| - |", "| 1 |", "| 3 |");
    expect(patchTable(original, canonical)).toBe(lines("| A   |", "| --- |", "| 1   |", "| 3 |"));
  });

  it("writes a column added in the middle the way the serializer does", () => {
    const canonical = lines("| A | X | B |", "| - | - | - |", "| 1 | x | 2 |", "| 3 | y | 4 |");
    expect(patchTable(original, canonical)).toBe(lines("| A | X | B |", "| --- | --- | --- |", "| 1 | x | 2 |", "| 3 | y | 4 |"));
  });

  it("changes one edited cell and no other line", () => {
    const canonical = lines("| A | B   |", "| - | --- |", "| 1 | 22  |", "| 3 | 4   |");
    expect(patchTable(original, canonical)).toBe(lines("| A   | B |", "| --- | --- |", "| 1   | 22 |", "| 3 | 4 |"));
  });
});

describe("what is not a table", () => {
  it("is refused", () => {
    expect(patchTable("just text", "| a |\n| - |")).toBeNull();
    expect(patchTable("| a |\n| - |", "just text")).toBeNull();
    expect(patchTable("| a |\n| b |", "| a |\n| - |")).toBeNull();
  });
});
