// The cells picked in a table, as the session keeps them: they go with the selection, and follow the table when it changes.

import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape, table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { selectionAt } from "../table/cells.ts";
import { EditorSession } from "./session.ts";

async function open() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  session.slides.add({ layout: "blank" });
  const [grid, other] = session.elements.insert([table(3, 4, { x: 100, y: 100, w: 400, h: 150 }), shape("rect", { x: 600, y: 100, w: 100, h: 100 })]) as [string, string];
  session.select([]);
  return { session, grid, other };
}

const at = (row: number, col: number) => ({ row, col });

describe("picking cells", () => {
  it("selects the table, and keeps the cells picked", async () => {
    const { session, grid } = await open();
    session.selectCells(selectionAt(grid, at(1, 2)));
    expect(session.state.selection).toEqual([grid]);
    expect(session.state.cells).toEqual(selectionAt(grid, at(1, 2)));
    expect(session.state.editing).toBeNull();
  });

  it("is told nothing of an element that is not a table, or is not there", async () => {
    const { session, other } = await open();
    session.selectCells(selectionAt(other, at(0, 0)));
    session.selectCells(selectionAt("missing", at(0, 0)));
    expect(session.state.cells).toBeNull();
    expect(session.state.selection).toEqual([]);
  });

  it("keeps the table selected when the cells are taken off, and writes nothing", async () => {
    const { session, grid } = await open();
    session.selectCells(selectionAt(grid, at(0, 0)));
    const revision = session.state.revision;
    session.selectCells(null);
    expect(session.state.cells).toBeNull();
    expect(session.state.selection).toEqual([grid]);
    expect(session.state.revision).toBe(revision);
  });

  it("does not tell the views again for the same cells", async () => {
    const { session, grid } = await open();
    session.selectCells(selectionAt(grid, at(0, 0)));
    const before = session.state;
    session.selectCells(selectionAt(grid, at(0, 0)));
    expect(session.state).toBe(before);
  });

  it("goes when something else is selected, or nothing, or the slide changes", async () => {
    const { session, grid, other } = await open();
    session.selectCells(selectionAt(grid, at(0, 0)));
    session.select([other]);
    expect(session.state.cells).toBeNull();
    session.selectCells(selectionAt(grid, at(0, 0)));
    session.select([]);
    expect(session.state.cells).toBeNull();
    session.selectCells(selectionAt(grid, at(0, 0)));
    session.slides.add({ layout: "blank" });
    expect(session.state.cells).toBeNull();
  });

  it("stays when the table is selected again", async () => {
    const { session, grid } = await open();
    session.selectCells(selectionAt(grid, at(2, 3)));
    session.select([grid]);
    expect(session.state.cells).toEqual(selectionAt(grid, at(2, 3)));
  });

  it("goes when the slides are picked in the filmstrip, or a drawing tool is armed", async () => {
    const { session, grid } = await open();
    session.selectCells(selectionAt(grid, at(0, 0)));
    session.selectSlides([session.state.slideId]);
    expect(session.state.cells).toBeNull();
    session.selectCells(selectionAt(grid, at(0, 0)));
    session.setTool("text");
    expect(session.state.cells).toBeNull();
  });

  it("goes when a text box is opened", async () => {
    const { session, grid, other } = await open();
    session.selectCells(selectionAt(grid, at(0, 0)));
    session.startEditing(other);
    expect(session.state.cells).toBeNull();
    expect(session.state.editing).toBe(other);
  });
});

describe("editing a cell", () => {
  it("opens the table with the cells, and leaving the edit keeps the cells picked", async () => {
    const { session, grid } = await open();
    session.startEditingCell(selectionAt(grid, at(1, 1)), { at: { x: 5, y: 6 } });
    expect(session.state.editing).toBe(grid);
    expect(session.state.cells).toEqual(selectionAt(grid, at(1, 1)));
    expect(session.state.editFrom).toEqual({ at: { x: 5, y: 6 } });
    session.stopEditing();
    expect(session.state.editing).toBeNull();
    expect(session.state.cells).toEqual(selectionAt(grid, at(1, 1)));
  });

  it("does not open a table that is locked, or an element that is not a table", async () => {
    const { session, grid, other } = await open();
    session.elements.lock(true, [grid]);
    session.startEditingCell(selectionAt(grid, at(0, 0)));
    expect(session.state.editing).toBeNull();
    session.startEditingCell(selectionAt(other, at(0, 0)));
    expect(session.state.editing).toBeNull();
  });

  it("moves to another cell of the same table", async () => {
    const { session, grid } = await open();
    session.startEditingCell(selectionAt(grid, at(0, 0)));
    session.startEditingCell(selectionAt(grid, at(0, 1)));
    expect(session.state.editing).toBe(grid);
    expect(session.state.cells?.focus).toEqual(at(0, 1));
  });
});

describe("when the table changes under the cells", () => {
  it("moves them into the table when rows go, and back is not forced when the rows return", async () => {
    const { session, grid } = await open();
    session.selectCells({ table: grid, anchor: at(2, 0), focus: at(2, 3) });
    const element = session.slide.elements.find((e) => e.id === grid);
    if (element?.type !== "table") throw new Error("a table");
    session.elements.patch({ rows: element.rows.slice(0, 2) as never }, [grid]);
    expect(session.state.cells).toEqual({ table: grid, anchor: at(1, 0), focus: at(1, 3) });
    session.undo();
    expect(session.state.cells).toEqual({ table: grid, anchor: at(1, 0), focus: at(1, 3) });
  });

  it("drops them, and the edit, when the table is deleted", async () => {
    const { session, grid } = await open();
    session.startEditingCell(selectionAt(grid, at(1, 1)));
    session.elements.remove([grid]);
    expect(session.state.cells).toBeNull();
    expect(session.state.editing).toBeNull();
    expect(session.state.selection).toEqual([]);
    session.undo();
    expect(session.state.cells).toBeNull();
  });

  it("keeps the cells through a change to something else on the slide", async () => {
    const { session, grid, other } = await open();
    session.selectCells(selectionAt(grid, at(1, 1)));
    session.elements.patch({ name: "x" }, [other]);
    expect(session.state.cells).toEqual(selectionAt(grid, at(1, 1)));
  });
});
