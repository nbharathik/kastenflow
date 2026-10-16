// What the editor does to the cells picked: each is an operation of the engine, one step of undo, and the pick follows.

import type { Element, Text } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { textOfWords } from "../clipboard/table.ts";
import { table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { selectionAt } from "./cells.ts";

type TableEl = Extract<Element, { type: "table" }>;

async function open(rows = 3, columns = 3, notes: string[] = []) {
  const errors: string[] = [];
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000, onError: (message) => errors.push(message) });
  session.slides.add({ layout: "blank" });
  const [id] = session.elements.insert([table(rows, columns, { x: 100, y: 100, w: 300, h: 150 })]) as [string];
  session.select([]);
  const grid = () => session.slide.elements.find((e) => e.id === id) as TableEl;
  const words = () => grid().rows.map((row) => row.cells.map((cell) => cell.text.paragraphs.map((p) => p.runs.map((r) => r.t).join("")).join("\n")));
  return { session, id, errors, grid, words, notes };
}

const text = (t: string): Text => textOfWords(t);
const at = (row: number, col: number) => ({ row, col });

/** A table with its cells written "r0c0", "r0c1" ... */
async function filled(rows = 3, columns = 3) {
  const made = await open(rows, columns);
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => ({ text: text(`r${r}c${c}`) })));
  made.session.core.apply("set_cells", { slide: made.session.state.slideId, id: made.id, at: at(0, 0), cells });
  return made;
}

describe("writing a cell", () => {
  it("sets the words of one cell, as one step of undo", async () => {
    const { session, id, words } = await open();
    session.tables.setCell(id, at(1, 2), text("hello"));
    expect(words()[1]).toEqual(["", "", "hello"]);
    session.undo();
    expect(words()[1]).toEqual(["", "", ""]);
  });

  it("says nothing and writes nothing when the table is gone", async () => {
    const { session, id, errors } = await open();
    const slide = session.state.slideId;
    session.elements.remove([id]);
    session.tables.setCell(id, at(0, 0), text("late"), slide);
    expect(errors).toEqual([]);
    expect(session.slide.elements.some((e) => e.id === id)).toBe(false);
  });
});

describe("emptying cells", () => {
  it("empties the cells picked and leaves the table and the other cells", async () => {
    const { session, id, words, grid } = await filled();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    session.tables.clear();
    expect(words()).toEqual([["", "", "r0c2"], ["", "", "r1c2"], ["r2c0", "r2c1", "r2c2"]]);
    expect(grid().columns).toHaveLength(3);
    expect(session.state.cells).toEqual({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    session.undo();
    expect(words()[0]).toEqual(["r0c0", "r0c1", "r0c2"]);
  });

  it("does nothing with no cells picked", async () => {
    const { session, words } = await filled();
    const before = words();
    session.tables.clear();
    expect(words()).toEqual(before);
  });
});

describe("copying and pasting cells", () => {
  it("copies the words of the cells picked, row by row", async () => {
    const { session, id } = await filled();
    session.selectCells({ table: id, anchor: at(1, 0), focus: at(2, 1) });
    expect(session.tables.copy()?.map((row) => row.map((cell) => cell.paragraphs[0]?.runs[0]?.t))).toEqual([["r1c0", "r1c1"], ["r2c0", "r2c1"]]);
  });

  it("copies a merged cell's words at its first place and nothing in the places it covers", async () => {
    const { session, id } = await filled();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(0, 1) });
    session.tables.merge();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    const copied = session.tables.copy()?.map((row) => row.map((cell) => cell.paragraphs[0]?.runs[0]?.t));
    expect(copied?.[0]?.[1]).toBe("");
    expect(copied?.[0]?.[0]).toContain("r0c0");
  });

  it("pastes from the first cell picked, picks what it put in, and is one step of undo", async () => {
    const { session, id, words } = await filled();
    session.selectCells(selectionAt(id, at(1, 1)));
    session.tables.paste([[text("a"), text("b")], [text("c"), text("d")]]);
    expect(words()).toEqual([["r0c0", "r0c1", "r0c2"], ["r1c0", "a", "b"], ["r2c0", "c", "d"]]);
    expect(session.state.cells).toEqual({ table: id, anchor: at(1, 1), focus: at(2, 2) });
    session.undo();
    expect(words()[1]).toEqual(["r1c0", "r1c1", "r1c2"]);
  });

  it("adds the rows and the columns the block needs", async () => {
    const { session, id, words, grid } = await filled();
    session.selectCells(selectionAt(id, at(2, 2)));
    session.tables.paste([[text("x"), text("y")], [text("z"), text("w")]]);
    expect(grid().rows).toHaveLength(4);
    expect(grid().columns).toHaveLength(4);
    expect(words()[2]).toEqual(["r2c0", "r2c1", "x", "y"]);
    expect(words()[3]).toEqual(["", "", "z", "w"]);
    expect(session.state.cells).toEqual({ table: id, anchor: at(2, 2), focus: at(3, 3) });
  });

  it("pastes at the top left of a block that is picked", async () => {
    const { session, id, words } = await filled();
    session.selectCells({ table: id, anchor: at(2, 2), focus: at(1, 1) });
    session.tables.paste([[text("only")]]);
    expect(words()[1]?.[1]).toBe("only");
    expect(words()[2]?.[2]).toBe("r2c2");
  });

  it("says why when the block would cut a merged cell, and changes nothing", async () => {
    const { session, id, words, errors } = await filled();
    session.selectCells({ table: id, anchor: at(1, 0), focus: at(2, 0) });
    session.tables.merge();
    const before = words();
    session.selectCells(selectionAt(id, at(0, 0)));
    session.tables.paste([[text("a")], [text("b")], [text("c")]]);
    expect(words()).toEqual(before);
    expect(errors.join(" ")).toMatch(/merged cell/i);
  });
});

describe("rows and columns", () => {
  it("puts a row above, as many as are picked, and the same cells stay picked", async () => {
    const { session, id, grid } = await filled();
    session.selectCells({ table: id, anchor: at(1, 0), focus: at(2, 1) });
    session.tables.insertRows("above");
    expect(grid().rows).toHaveLength(5);
    expect(session.state.cells).toEqual({ table: id, anchor: at(3, 0), focus: at(4, 1) });
    expect(grid().rows[3]?.cells[0]?.text.paragraphs[0]?.runs[0]?.t).toBe("r1c0");
  });

  it("puts a row below, and what is picked stays where it is", async () => {
    const { session, id, grid, words } = await filled();
    session.selectCells(selectionAt(id, at(0, 0)));
    session.tables.insertRows("below");
    expect(grid().rows).toHaveLength(4);
    expect(words()[1]).toEqual(["", "", ""]);
    expect(session.state.cells).toEqual(selectionAt(id, at(0, 0)));
  });

  it("puts columns to the left and the right", async () => {
    const { session, id, grid, words } = await filled();
    session.selectCells(selectionAt(id, at(0, 1)));
    session.tables.insertColumns("left");
    expect(grid().columns).toHaveLength(4);
    expect(words()[0]).toEqual(["r0c0", "", "r0c1", "r0c2"]);
    expect(session.state.cells).toEqual(selectionAt(id, at(0, 2)));
    session.tables.insertColumns("right");
    expect(words()[0]).toEqual(["r0c0", "", "r0c1", "", "r0c2"]);
    expect(session.state.cells).toEqual(selectionAt(id, at(0, 2)));
  });

  it("adds a row at the end for Tab, and says where its first cell is", async () => {
    const { session, id, grid } = await filled();
    expect(session.tables.appendRow(id)).toEqual(at(3, 0));
    expect(grid().rows).toHaveLength(4);
    expect(session.tables.appendRow("missing")).toBeNull();
  });

  it("deletes the rows and the columns picked", async () => {
    const { session, id, grid, words } = await filled();
    session.selectCells({ table: id, anchor: at(0, 1), focus: at(1, 1) });
    session.tables.deleteRows();
    expect(words()).toEqual([["r2c0", "r2c1", "r2c2"]]);
    session.undo();
    session.selectCells({ table: id, anchor: at(0, 1), focus: at(1, 1) });
    session.tables.deleteColumns();
    expect(grid().columns).toHaveLength(2);
    expect(words()[0]).toEqual(["r0c0", "r0c2"]);
  });

  it("is refused for every row of the table, in words", async () => {
    const { session, id, grid, errors } = await filled();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(2, 2) });
    session.tables.deleteRows();
    expect(grid().rows).toHaveLength(3);
    expect(errors.join(" ")).toMatch(/delete the table/i);
  });
});

describe("merging and filling", () => {
  it("merges the cells picked into one, keeps their words, and picks the new cell", async () => {
    const { session, id, grid } = await filled();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    expect(session.tables.canMerge).toBe(true);
    session.tables.merge();
    const first = grid().rows[0]?.cells[0];
    expect([first?.colSpan, first?.rowSpan]).toEqual([2, 2]);
    expect(first?.text.paragraphs.map((p) => p.runs[0]?.t)).toContain("r0c0");
    expect(session.state.cells).toEqual({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    expect(session.tables.canMerge).toBe(false);
    expect(session.tables.canUnmerge).toBe(true);
  });

  it("splits every merged cell in the block back, in one step of undo", async () => {
    const { session, id, grid } = await filled(4, 4);
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(0, 1) });
    session.tables.merge();
    session.selectCells({ table: id, anchor: at(2, 2), focus: at(3, 3) });
    session.tables.merge();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(3, 3) });
    session.tables.unmerge();
    expect(grid().rows.flatMap((row) => row.cells).every((cell) => (cell.colSpan ?? 1) === 1 && (cell.rowSpan ?? 1) === 1)).toBe(true);
    session.undo();
    expect(grid().rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(grid().rows[2]?.cells[2]?.colSpan).toBe(2);
  });

  it("cannot merge one cell, and cannot split one that is not merged", async () => {
    const { session, id } = await filled();
    session.selectCells(selectionAt(id, at(1, 1)));
    expect(session.tables.canMerge).toBe(false);
    expect(session.tables.canUnmerge).toBe(false);
  });

  it("fills the cells picked, and takes the fill away with null", async () => {
    const { session, id, grid } = await filled();
    session.selectCells({ table: id, anchor: at(1, 0), focus: at(1, 2) });
    session.tables.setFill({ color: "accent2", alpha: 0.5 });
    expect(grid().rows[1]?.cells.map((cell) => cell.fill?.color)).toEqual(["accent2", "accent2", "accent2"]);
    expect(grid().rows[0]?.cells[0]?.fill).toBeFalsy();
    expect(session.tables.fillOfFocus()).toEqual({ color: "accent2", alpha: 0.5 });
    session.tables.setFill(null);
    expect(grid().rows[1]?.cells.every((cell) => !cell.fill)).toBe(true);
  });

  it("picks every cell for select all", async () => {
    const { session, id } = await filled();
    session.selectCells(selectionAt(id, at(1, 1)));
    session.tables.selectAll();
    expect(session.state.cells).toEqual({ table: id, anchor: at(0, 0), focus: at(2, 2) });
  });
});
