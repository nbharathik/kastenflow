// The keys of a table whose cells are picked: the arrows, Tab, Enter, letters, select all, and Delete, which empties the cells rather
// than taking the table away.

import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { dispatchKey } from "../commands/index.ts";
import { table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { selectionAt } from "./cells.ts";
import { tableKeys } from "./keys.ts";
import { takeTyped } from "./typing.ts";

type TableEl = Extract<Element, { type: "table" }>;

async function open(rows = 3, columns = 3) {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  session.slides.add({ layout: "blank" });
  const [id] = session.elements.insert([table(rows, columns, { x: 100, y: 100, w: 300, h: 150 })]) as [string];
  session.select([]);
  const grid = () => session.slide.elements.find((e) => e.id === id) as TableEl;
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
    return { used: tableKeys(event, { session }), prevented: event.defaultPrevented };
  };
  return { session, ui, id, grid, press };
}

const at = (row: number, col: number) => ({ row, col });

describe("the arrow keys", () => {
  it("move the cell picked, and take the key so the table is not nudged", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(1, 1)));
    expect(press("ArrowRight")).toEqual({ used: true, prevented: true });
    expect(session.state.cells).toEqual(selectionAt(id, at(1, 2)));
    press("ArrowDown");
    press("ArrowLeft");
    press("ArrowLeft");
    press("ArrowUp");
    expect(session.state.cells).toEqual(selectionAt(id, at(1, 0)));
  });

  it("use the key at an edge too, and stay", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(0, 0)));
    expect(press("ArrowUp")).toEqual({ used: true, prevented: true });
    expect(press("ArrowLeft").used).toBe(true);
    expect(session.state.cells).toEqual(selectionAt(id, at(0, 0)));
  });

  it("with Shift extend the cells picked from the first one", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(0, 0)));
    press("ArrowRight", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(session.state.cells).toEqual({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    press("ArrowDown");
    expect(session.state.cells).toEqual(selectionAt(id, at(2, 1)));
  });

  it("are left alone with Ctrl, Cmd or Alt held", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(1, 1)));
    expect(press("ArrowRight", { ctrlKey: true }).used).toBe(false);
    expect(press("ArrowRight", { metaKey: true }).used).toBe(false);
    expect(press("ArrowRight", { altKey: true }).used).toBe(false);
    expect(session.state.cells).toEqual(selectionAt(id, at(1, 1)));
  });
});

describe("Tab", () => {
  it("goes to the next cell and back", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(0, 2)));
    expect(press("Tab")).toEqual({ used: true, prevented: true });
    expect(session.state.cells).toEqual(selectionAt(id, at(1, 0)));
    press("Tab", { shiftKey: true });
    expect(session.state.cells).toEqual(selectionAt(id, at(0, 2)));
  });

  it("adds a row on the last cell and picks its first cell, as one step of undo", async () => {
    const { session, id, grid, press } = await open();
    session.selectCells(selectionAt(id, at(2, 2)));
    press("Tab");
    expect(grid().rows).toHaveLength(4);
    expect(session.state.cells).toEqual(selectionAt(id, at(3, 0)));
    session.undo();
    expect(grid().rows).toHaveLength(3);
  });

  it("stays on the first cell with Shift", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(0, 0)));
    expect(press("Tab", { shiftKey: true }).used).toBe(true);
    expect(session.state.cells).toEqual(selectionAt(id, at(0, 0)));
  });
});

describe("Enter, F2 and letters", () => {
  it("open the cell for writing", async () => {
    const { session, id, press } = await open();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    expect(press("Enter")).toEqual({ used: true, prevented: true });
    expect(session.state.editing).toBe(id);
    expect(session.state.cells).toEqual(selectionAt(id, at(1, 1)));
    session.stopEditing();
    press("F2");
    expect(session.state.editing).toBe(id);
  });

  it("open the first place of a merged cell", async () => {
    const { session, id, press } = await open();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(0, 1) });
    session.tables.merge();
    session.selectCells(selectionAt(id, at(0, 1)));
    press("Enter");
    expect(session.state.cells).toEqual(selectionAt(id, at(0, 0)));
  });

  it("open the cell with a letter typed into it", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(1, 2)));
    expect(press("q")).toEqual({ used: true, prevented: true });
    expect(session.state.editing).toBe(id);
    expect(takeTyped(id)).toBe("q");
    expect(takeTyped(id)).toBeNull();
  });

  it("leave Space, Ctrl chords and Delete to the rest of the editor", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(1, 1)));
    expect(press(" ").used).toBe(false);
    expect(press("b", { ctrlKey: true }).used).toBe(false);
    expect(press("Delete").used).toBe(false);
    expect(press("Backspace").used).toBe(false);
    expect(session.state.editing).toBeNull();
  });

  it("do nothing to a locked table", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(1, 1)));
    session.elements.lock(true, [id]);
    press("Enter");
    expect(session.state.editing).toBeNull();
  });
});

describe("select all", () => {
  it("picks every cell", async () => {
    const { session, id, press } = await open();
    session.selectCells(selectionAt(id, at(1, 1)));
    expect(press("a", { ctrlKey: true })).toEqual({ used: true, prevented: true });
    expect(session.state.cells).toEqual({ table: id, anchor: at(0, 0), focus: at(2, 2) });
  });
});

describe("when there is nothing to work on", () => {
  it("takes no key with no cells picked, or while a cell is open for writing", async () => {
    const { session, id, press } = await open();
    expect(press("ArrowRight").used).toBe(false);
    session.selectCells(selectionAt(id, at(1, 1)));
    session.startEditingCell(selectionAt(id, at(1, 1)));
    expect(press("ArrowRight").used).toBe(false);
    expect(press("Enter").used).toBe(false);
  });
});

describe("Delete", () => {
  const press = (key: string, ui: EditorUi, session: EditorSession) => dispatchKey(new KeyboardEvent("keydown", { key, cancelable: true }), { session, ui }, "stage");

  it("empties the cells picked and leaves the table, when cells are picked", async () => {
    const { session, ui, id, grid } = await open();
    session.tables.setCell(id, at(1, 1), { paragraphs: [{ runs: [{ t: "keep me not" }] }] });
    session.tables.setCell(id, at(2, 2), { paragraphs: [{ runs: [{ t: "me neither" }] }] });
    session.selectCells({ table: id, anchor: at(1, 1), focus: at(1, 1) });
    expect(press("Delete", ui, session)).toBe(true);
    expect(session.slide.elements.some((e) => e.id === id)).toBe(true);
    expect(grid().rows[1]?.cells[1]?.text.paragraphs.every((p) => p.runs.every((r) => r.t === ""))).toBe(true);
    expect(grid().rows[2]?.cells[2]?.text.paragraphs[0]?.runs[0]?.t).toBe("me neither");
  });

  it("does the same for Backspace, and for several cells", async () => {
    const { session, ui, id, grid } = await open();
    session.tables.setCell(id, at(0, 0), { paragraphs: [{ runs: [{ t: "a" }] }] });
    session.tables.setCell(id, at(1, 1), { paragraphs: [{ runs: [{ t: "b" }] }] });
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    press("Backspace", ui, session);
    expect(session.slide.elements.some((e) => e.id === id)).toBe(true);
    expect(grid().rows.every((row) => row.cells.every((cell) => cell.text.paragraphs.every((p) => p.runs.every((r) => r.t === ""))))).toBe(true);
  });

  it("takes the table away when it is only the frame that is selected", async () => {
    const { session, ui, id } = await open();
    session.select([id]);
    press("Delete", ui, session);
    expect(session.slide.elements.some((e) => e.id === id)).toBe(false);
  });

  it("takes the table away after the cells were let go with the frame still selected", async () => {
    const { session, ui, id } = await open();
    session.selectCells(selectionAt(id, at(0, 0)));
    session.selectCells(null);
    press("Delete", ui, session);
    expect(session.slide.elements.some((e) => e.id === id)).toBe(false);
  });
});
