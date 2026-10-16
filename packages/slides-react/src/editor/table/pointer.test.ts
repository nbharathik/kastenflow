// What the pointer does on a table: a click picks a cell, a drag in a table whose cells are picked picks more, a double click opens the
// cell for writing, and a drag of a table that is not being worked on still moves it.

import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { CanvasController, type PointerInfo } from "../canvas/controller.ts";
import { table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { selectionAt } from "./cells.ts";
import { placeUnder } from "./pointer.ts";

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1, client: { x: x + 1000, y: y + 500 }, ...extra });

/** A 3 x 4 table at (100, 100), 400 by 150: cells 100 wide and 50 tall. */
async function open(locked = false) {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  const controller = new CanvasController(session, ui, () => 1);
  session.slides.add({ layout: "blank" });
  const [grid] = session.elements.insert([table(3, 4, { x: 100, y: 100, w: 400, h: 150 })]) as [string];
  if (locked) session.elements.lock(true, [grid]);
  session.select([]);
  const click = (x: number, y: number, extra: Partial<PointerInfo> = {}) => {
    controller.down(at(x, y, extra), { kind: "surface" });
    controller.up(at(x, y, extra));
  };
  return { session, ui, controller, grid, click };
}

describe("the place under a point", () => {
  it("is the cell under it, in the table's own units", async () => {
    const { session, grid } = await open();
    expect(placeUnder(session, grid, { x: 110, y: 110 })).toEqual({ row: 0, col: 0 });
    expect(placeUnder(session, grid, { x: 450, y: 240 })).toEqual({ row: 2, col: 3 });
    expect(placeUnder(session, grid, { x: 99, y: 110 })).toBeNull();
    expect(placeUnder(session, grid, { x: 99, y: 110 }, true)).toEqual({ row: 0, col: 0 });
  });

  it("turns the point back for a table that is turned about its middle", async () => {
    const { session, grid } = await open();
    session.elements.patch({ rotation: 90 }, [grid]);
    // Turned a quarter clockwise about (300, 175): the table's top left corner (100, 100) is now at the top right, (375, -25).
    expect(placeUnder(session, grid, { x: 365, y: -15 })).toEqual({ row: 0, col: 0 });
    // And its right end is at the bottom: local (390, 140) is at (235, 365).
    expect(placeUnder(session, grid, { x: 235, y: 365 })).toEqual({ row: 2, col: 3 });
  });

  it("is nothing for an element that is not a table", async () => {
    const { session } = await open();
    expect(placeUnder(session, "missing", { x: 110, y: 110 })).toBeNull();
  });
});

describe("a click on a table", () => {
  it("selects it and picks the cell under the pointer", async () => {
    const { session, grid, click } = await open();
    click(210, 160);
    expect(session.state.selection).toEqual([grid]);
    expect(session.state.cells).toEqual(selectionAt(grid, { row: 1, col: 1 }));
    expect(session.state.editing).toBeNull();
  });

  it("picks another cell with the next click, and the table does not move", async () => {
    const { session, grid, click } = await open();
    click(210, 160);
    click(410, 230);
    expect(session.state.cells).toEqual(selectionAt(grid, { row: 2, col: 3 }));
    expect(session.slide.elements.find((e) => e.id === grid)).toMatchObject({ x: 100, y: 100 });
  });

  it("picks the cell again in a table whose frame is what is selected, rather than moving it", async () => {
    const { session, grid, click } = await open();
    click(210, 160);
    session.selectCells(null);
    expect(session.state.selection).toEqual([grid]);
    click(310, 110);
    expect(session.state.cells).toEqual(selectionAt(grid, { row: 0, col: 2 }));
  });

  it("with Shift extends from the cell that was picked", async () => {
    const { session, grid, click } = await open();
    click(110, 110);
    click(410, 160, { shift: true });
    expect(session.state.cells).toEqual({ table: grid, anchor: { row: 0, col: 0 }, focus: { row: 1, col: 3 } });
  });

  it("is only a toggle of the table with Shift when the table was not worked on", async () => {
    const { session, grid, click } = await open();
    click(110, 110, { shift: true });
    expect(session.state.selection).toEqual([grid]);
    expect(session.state.cells).toBeNull();
  });
});

describe("a drag on a table whose cells are picked", () => {
  it("picks the cells between, moving nothing", async () => {
    const { session, grid, controller, click } = await open();
    click(110, 110);
    controller.down(at(110, 110), { kind: "surface" });
    controller.move(at(360, 160));
    expect(session.state.cells).toEqual({ table: grid, anchor: { row: 0, col: 0 }, focus: { row: 1, col: 2 } });
    controller.move(at(210, 210));
    controller.up(at(210, 210));
    expect(session.state.cells).toEqual({ table: grid, anchor: { row: 0, col: 0 }, focus: { row: 2, col: 1 } });
    expect(session.slide.elements.find((e) => e.id === grid)).toMatchObject({ x: 100, y: 100 });
  });

  it("keeps the nearest cell when the pointer leaves the table", async () => {
    const { session, grid, controller, click } = await open();
    click(110, 110);
    controller.down(at(110, 110), { kind: "surface" });
    controller.move(at(900, 700));
    controller.up(at(900, 700));
    expect(session.state.cells).toEqual({ table: grid, anchor: { row: 0, col: 0 }, focus: { row: 2, col: 3 } });
  });

  it("is called off by Escape, which leaves the cells as they were last picked", async () => {
    const { session, controller, click } = await open();
    click(110, 110);
    controller.down(at(110, 110), { kind: "surface" });
    controller.move(at(260, 160));
    expect(controller.cancel()).toBe(true);
    expect(session.state.cells?.table).toBeTruthy();
  });
});

describe("a drag of a table that is not being worked on", () => {
  it("moves it, as a drag of any block does", async () => {
    const { session, grid, controller } = await open();
    controller.down(at(210, 160), { kind: "surface" });
    controller.move(at(260, 190));
    controller.up(at(260, 190));
    const moved = session.slide.elements.find((e) => e.id === grid);
    expect(moved).toMatchObject({ x: expect.any(Number) });
    expect((moved as { x: number }).x).toBeGreaterThan(130);
    expect(session.state.cells).toBeNull();
  });

  it("moves from the move handle even when its cells are picked", async () => {
    const { session, grid, controller, click } = await open();
    click(210, 160);
    controller.down(at(90, 90), { kind: "move", id: null });
    controller.move(at(190, 140));
    controller.up(at(190, 140));
    expect((session.slide.elements.find((e) => e.id === grid) as { x: number }).x).toBeGreaterThan(150);
  });
});

describe("a double click on a table", () => {
  it("opens the cell under it for writing, with the word under the pointer taken", async () => {
    const { session, grid, controller } = await open();
    controller.doubleClick(at(310, 160, { detail: 2 }));
    expect(session.state.editing).toBe(grid);
    expect(session.state.selection).toEqual([grid]);
    expect(session.state.cells).toEqual(selectionAt(grid, { row: 1, col: 2 }));
    expect(session.state.editFrom).toEqual({ at: { x: 1310, y: 660 }, select: "word" });
  });

  it("does nothing to a table that is locked", async () => {
    const { session, controller } = await open(true);
    controller.doubleClick(at(310, 160, { detail: 2 }));
    expect(session.state.editing).toBeNull();
    expect(session.state.cells).toBeNull();
  });

  it("does nothing while a drawing tool is armed", async () => {
    const { session, controller } = await open();
    session.setTool("text");
    controller.doubleClick(at(310, 160, { detail: 2 }));
    expect(session.state.editing).toBeNull();
  });
});

describe("a click on a table that is locked", () => {
  it("picks no cell, as it picks nothing of a locked block", async () => {
    const { session, click } = await open(true);
    click(210, 160);
    expect(session.state.cells).toBeNull();
    expect(session.state.editing).toBeNull();
  });
});
