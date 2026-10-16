// The menus a right click opens that are not about a block or a slide: the cells of a table, the empty room of the filmstrip and a side
// panel, and the layout rows of the slide menus.

import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { table } from "../factory.ts";
import { selectionAt } from "../table/cells.ts";
import type { ContextMenuState } from "../ui-state.ts";
import { ContextMenus } from "./ContextMenus.tsx";
import { contextMenuHandler } from "./open.ts";
import { isDisabled, openEditor, row } from "./testing.ts";

type TableEl = Extract<Element, { type: "table" }>;

afterEach(cleanup);

/** The labels of the rows of the open menu, in order. */
const labels = () => [...(screen.getAllByRole("menu")[0]?.querySelectorAll(":scope > button > .ks-menu-label") ?? [])].map((r) => r.textContent);

async function setup() {
  const editor = await openEditor();
  const { session, ui } = editor;
  session.slides.add({ layout: "blank" });
  const [id] = session.elements.insert([table(4, 4, { x: 100, y: 100, w: 400, h: 200 })]) as [string];
  session.select([]);
  render(<ContextMenus session={session} ui={ui} />);
  const open = (kind: ContextMenuState["kind"]) => act(() => ui.openContextMenu({ kind, x: 120, y: 80 }));
  const grid = () => session.slide.elements.find((e) => e.id === id) as TableEl;
  return { ...editor, id, open, grid };
}

const at = (r: number, c: number) => ({ row: r, col: c });

describe("the menu of the cells of a table", () => {
  it("offers the clipboard, rows and columns, merging, and the table", async () => {
    const { session, id, open } = await setup();
    act(() => session.selectCells(selectionAt(id, at(1, 1))));
    open("cells");
    expect(labels()).toEqual([
      "Cut",
      "Copy",
      "Paste",
      "Clear",
      "Insert row above",
      "Insert row below",
      "Insert column left",
      "Insert column right",
      "Delete row",
      "Delete column",
      "Merge cells",
      "Unmerge cells",
      "Format options",
      "Select table",
      "Delete table",
    ]);
  });

  it("counts the rows and columns picked", async () => {
    const { session, id, open } = await setup();
    act(() => session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 2) }));
    open("cells");
    expect(labels()).toEqual(expect.arrayContaining(["Insert 2 rows above", "Insert 2 rows below", "Insert 3 columns left", "Insert 3 columns right", "Delete 2 rows", "Delete 3 columns"]));
  });

  it("merges only several cells, and splits only merged ones", async () => {
    const { session, id, open } = await setup();
    act(() => session.selectCells(selectionAt(id, at(1, 1))));
    open("cells");
    expect(isDisabled(row("Merge cells"))).toBe(true);
    expect(isDisabled(row("Unmerge cells"))).toBe(true);
    cleanup();
    const second = await setup();
    act(() => second.session.selectCells({ table: second.id, anchor: at(0, 0), focus: at(0, 1) }));
    second.open("cells");
    expect(isDisabled(row("Merge cells"))).toBe(false);
  });

  it("adds a row when asked, and closes", async () => {
    const { session, id, ui, open, grid } = await setup();
    act(() => session.selectCells(selectionAt(id, at(0, 0))));
    open("cells");
    fireEvent.click(row("Insert row below"));
    expect(grid().rows).toHaveLength(5);
    expect(ui.state.contextMenu).toBeNull();
  });

  it("empties the cells with Clear, and the table stays", async () => {
    const { session, id, open, grid } = await setup();
    session.tables.setCell(id, at(1, 1), { paragraphs: [{ runs: [{ t: "words" }] }] });
    act(() => session.selectCells(selectionAt(id, at(1, 1))));
    open("cells");
    fireEvent.click(row("Clear"));
    expect(grid().rows[1]?.cells[1]?.text.paragraphs.every((p) => p.runs.every((r) => r.t === ""))).toBe(true);
  });

  it("picks the frame with Select table, and takes the table away with Delete table", async () => {
    const { session, id, open } = await setup();
    act(() => session.selectCells(selectionAt(id, at(1, 1))));
    open("cells");
    fireEvent.click(row("Select table"));
    expect(session.state.cells).toBeNull();
    expect(session.state.selection).toEqual([id]);
    act(() => session.selectCells(selectionAt(id, at(1, 1))));
    open("cells");
    fireEvent.click(row("Delete table"));
    expect(session.slide.elements.some((e) => e.id === id)).toBe(false);
  });

  it("opens the Format options", async () => {
    const { session, id, ui, open } = await setup();
    act(() => session.selectCells(selectionAt(id, at(1, 1))));
    open("cells");
    fireEvent.click(row(/^Format options/));
    expect(ui.state.panel).toBe("format");
  });
});

describe("the menu of the empty room of the filmstrip", () => {
  it("offers a new slide, a paste and a new section", async () => {
    const { open } = await setup();
    open("filmstrip");
    expect(labels()).toEqual(["New slide", "Paste", "Add section here"]);
  });

  it("makes a new slide", async () => {
    const { session, open } = await setup();
    const before = session.deck.slides.length;
    open("filmstrip");
    fireEvent.click(row(/^New slide/));
    expect(session.deck.slides).toHaveLength(before + 1);
  });

  it("adds a section", async () => {
    const { session, open } = await setup();
    open("filmstrip");
    fireEvent.click(row(/^Add section/));
    expect(session.deck.sections?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("the menu of a side panel", () => {
  it("offers to close it, and to open another", async () => {
    const { ui, open } = await setup();
    act(() => ui.openPanel("themes"));
    open("panel");
    expect(labels()).toEqual(["Close panel", "Format options", "Themes and layouts", "Transitions and motion", "Steps", "Assistant"]);
  });

  it("closes the panel", async () => {
    const { ui, open } = await setup();
    act(() => ui.openPanel("themes"));
    open("panel");
    fireEvent.click(row("Close panel"));
    expect(ui.state.panel).toBeNull();
  });

  it("opens another panel in its place", async () => {
    const { ui, open } = await setup();
    act(() => ui.openPanel("themes"));
    open("panel");
    fireEvent.click(row("Steps"));
    expect(ui.state.panel).toBe("steps");
  });

  it("marks the panel that is open", async () => {
    const { ui, open } = await setup();
    act(() => ui.openPanel("steps"));
    open("panel");
    expect(row("Steps").getAttribute("aria-checked")).toBe("true");
    expect(row("Themes and layouts").getAttribute("aria-checked")).toBe("false");
  });
});

describe("Save as layout and Reset to layout", () => {
  it("are in the menu of the empty slide and in the menu of a slide of the filmstrip", async () => {
    const { open } = await setup();
    open("canvas");
    expect(labels()).toEqual(expect.arrayContaining(["Save slide as layout…", "Reset slide to layout"]));
    cleanup();
    const second = await setup();
    second.open("slide");
    expect(labels()).toEqual(expect.arrayContaining(["Save slide as layout…", "Reset slide to layout"]));
  });

  it("open the dialog that saves the layout", async () => {
    const { ui, open } = await setup();
    open("slide");
    fireEvent.click(row("Save slide as layout…"));
    expect(ui.state.dialog).toBe("layout-save");
  });
});

describe("opening a menu from another region", () => {
  it("is where the pointer was, in place of the browser's own menu", async () => {
    const { ui } = await setup();
    let prevented = false;
    contextMenuHandler(ui, "filmstrip")({ clientX: 33, clientY: 44, preventDefault: () => void (prevented = true) });
    expect(prevented).toBe(true);
    expect(ui.state.contextMenu).toEqual({ kind: "filmstrip", x: 33, y: 44 });
  });

  it("is left alone for a click it does not accept", async () => {
    const { ui } = await setup();
    let prevented = false;
    contextMenuHandler(ui, "filmstrip", () => false)({ clientX: 1, clientY: 2, preventDefault: () => void (prevented = true) });
    expect(prevented).toBe(false);
    expect(ui.state.contextMenu).toBeNull();
  });
});
