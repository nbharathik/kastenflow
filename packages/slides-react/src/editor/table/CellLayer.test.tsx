// A cell of a table opened for writing, on the canvas: a double click opens it, and the keys do what the table needs of them while the
// arrows, Home and End stay the text's. What is typed goes in when the edit ends (not by Escape), as one step of undo.

import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { viewOfHandle } from "../../text/handle.ts";
import { installDomShims } from "../../text/test-support.ts";
import { SlideCanvas } from "../canvas/SlideCanvas.tsx";
import { table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { selectionAt } from "./cells.ts";

type TableEl = Extract<Element, { type: "table" }>;

afterEach(cleanup);

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {} });
  installDomShims();
});

/** A 3 x 3 table at (100, 100), 300 by 150, with a header row: cells 100 wide and 50 tall. */
async function open() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  const ui = new EditorUi();
  ui.setZoom(1);
  session.slides.add({ layout: "blank" });
  const [id] = session.elements.insert([table(3, 3, { x: 100, y: 100, w: 300, h: 150 })]) as [string];
  session.select([]);
  const view = render(<SlideCanvas session={session} ui={ui} />);
  const grid = () => session.slide.elements.find((e) => e.id === id) as TableEl;
  const words = () => grid().rows.map((row) => row.cells.map((cell) => cell.text.paragraphs.map((p) => p.runs.map((r) => r.t).join("")).join("\n")));
  const editor = () => viewOfHandle(ui.state.text!)!;
  const press = (key: string, init: KeyboardEventInit & { keyCode?: number } = {}) => fireEvent.keyDown(editor().dom, { key, ...init });
  const type = (text: string) => act(() => ui.state.text!.insertText(text));
  /** Opens the cell at a row and column: a double click on it. */
  const openCell = (row: number, col: number) => fireEvent.doubleClick(view.container.querySelector(".ks-page")!, { clientX: 100 + col * 100 + 50, clientY: 100 + row * 50 + 25 });
  return { session, ui, id, view, grid, words, editor, press, type, openCell };
}

describe("a double click on a table cell", () => {
  it("opens the cell for writing, with the editor over it", async () => {
    const { session, ui, id, view, openCell } = await open();
    openCell(1, 1);
    expect(session.state.editing).toBe(id);
    expect(session.state.cells).toEqual(selectionAt(id, { row: 1, col: 1 }));
    const layer = view.container.querySelector<HTMLElement>(".ks-cell-layer");
    expect(layer).not.toBeNull();
    expect(layer?.dataset.cell).toBe("1,1");
    expect(layer?.querySelector("[role=textbox]")).not.toBeNull();
    expect(ui.state.text, "the commands reach the cell's editor").not.toBeNull();
  });

  it("leaves out the words of that cell from the drawing under it and no other", async () => {
    const { session, id, view, grid, openCell } = await open();
    session.tables.setCell(id, { row: 0, col: 0 }, { paragraphs: [{ runs: [{ t: "head" }] }] });
    session.tables.setCell(id, { row: 1, col: 1 }, { paragraphs: [{ runs: [{ t: "open" }] }] });
    session.tables.setCell(id, { row: 2, col: 2 }, { paragraphs: [{ runs: [{ t: "tail" }] }] });
    openCell(1, 1);
    const cells = [...view.container.querySelectorAll(".ks-slide td")];
    expect(grid().rows).toHaveLength(3);
    expect(cells).toHaveLength(9);
    expect(cells[4]?.textContent).toBe("");
    expect(cells[0]?.textContent).toBe("head");
    expect(cells[8]?.textContent).toBe("tail");
  });

  it("puts what is typed in that cell when the edit ends, as one step of undo", async () => {
    const { session, words, type, openCell } = await open();
    openCell(1, 2);
    type("Hello");
    act(() => session.stopEditing());
    expect(words()[1]).toEqual(["", "", "Hello"]);
    expect(session.state.undoLabel).toBe("set_cells");
    act(() => session.undo());
    expect(words()[1]).toEqual(["", "", ""]);
  });

  it("has the editor in a box of its own inside a layer the size of the table, so the stylesheet can leave the rest of the table to the pointer", async () => {
    const { view, openCell } = await open();
    openCell(1, 1);
    const layer = view.container.querySelector<HTMLElement>(".ks-cell-layer")!;
    const cell = layer.querySelector<HTMLElement>(".ks-cell-editor")!;
    expect([layer.style.width, layer.style.height]).toEqual(["300px", "150px"]);
    expect([cell.style.left, cell.style.top, cell.style.width, cell.style.height]).toEqual(["100px", "50px", "100px", "50px"]);
    expect(cell.querySelector("[role=textbox]")).not.toBeNull();
  });

  it("does nothing to a table that is locked", async () => {
    const { session, id, openCell } = await open();
    session.elements.lock(true, [id]);
    openCell(1, 1);
    expect(session.state.editing).toBeNull();
  });
});

describe("Enter in a cell", () => {
  it("writes the cell and opens the one below", async () => {
    const { session, id, words, press, type, openCell } = await open();
    openCell(0, 1);
    type("top");
    press("Enter", { keyCode: 13 });
    expect(words()[0]).toEqual(["", "top", ""]);
    expect(session.state.editing).toBe(id);
    expect(session.state.cells).toEqual(selectionAt(id, { row: 1, col: 1 }));
  });

  it("writes the cell and closes it on the last row, leaving the cell picked", async () => {
    const { session, id, words, press, type, openCell } = await open();
    openCell(2, 0);
    type("end");
    press("Enter", { keyCode: 13 });
    expect(words()[2]).toEqual(["end", "", ""]);
    expect(session.state.editing).toBeNull();
    expect(session.state.cells).toEqual(selectionAt(id, { row: 2, col: 0 }));
  });
});

describe("Shift+Enter in a cell", () => {
  it("breaks the paragraph and keeps the cell open", async () => {
    const { session, words, press, type, openCell } = await open();
    openCell(1, 1);
    type("one");
    press("Enter", { shiftKey: true, keyCode: 13 });
    type("two");
    expect(session.state.editing).not.toBeNull();
    act(() => session.stopEditing());
    expect(words()[1]?.[1]).toBe("one\ntwo");
  });
});

describe("Escape in a cell", () => {
  it("puts what was typed away, closes the cell, and keeps it picked", async () => {
    const { session, id, words, press, type, openCell } = await open();
    openCell(1, 1);
    type("never");
    press("Escape", { keyCode: 27 });
    expect(session.state.editing).toBeNull();
    expect(session.state.cells).toEqual(selectionAt(id, { row: 1, col: 1 }));
    expect(words()[1]).toEqual(["", "", ""]);
    expect(session.state.undoLabel).not.toBe("set_cells");
  });
});

describe("leaving the cell", () => {
  it("writes it when the focus goes", async () => {
    const { session, words, editor, type, openCell } = await open();
    openCell(0, 0);
    type("kept");
    fireEvent.blur(editor().dom);
    expect(session.state.editing).toBeNull();
    expect(words()[0]?.[0]).toBe("kept");
  });

  it("writes it when another cell is picked", async () => {
    const { session, id, words, type, openCell, view } = await open();
    openCell(0, 0);
    type("first");
    const page = view.container.querySelector(".ks-page")!;
    fireEvent.pointerDown(page, { button: 0, pointerId: 1, clientX: 350, clientY: 225 });
    fireEvent.pointerUp(page, { button: 0, pointerId: 1, clientX: 350, clientY: 225 });
    expect(words()[0]?.[0]).toBe("first");
    expect(session.state.editing).toBeNull();
    expect(session.state.cells).toEqual(selectionAt(id, { row: 2, col: 2 }));
  });

  it("writes nothing when the words are as they were", async () => {
    const { session, id, editor, openCell } = await open();
    session.tables.setCell(id, { row: 1, col: 1 }, { paragraphs: [{ runs: [{ t: "same" }] }] });
    openCell(1, 1);
    const label = session.state.undoLabel;
    const revision = session.state.revision;
    fireEvent.blur(editor().dom);
    expect(session.state.revision).toBe(revision);
    expect(session.state.undoLabel).toBe(label);
  });
});

describe("the other keys in a cell", () => {
  it("leave the arrows, Home and End to the text: the caret moves in the cell and the cell stays", async () => {
    const { session, id, press, type, openCell } = await open();
    openCell(1, 1);
    type("some words");
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) press(key);
    expect(session.state.editing).toBe(id);
    expect(session.state.cells).toEqual(selectionAt(id, { row: 1, col: 1 }));
  });
});

describe("Tab in a cell", () => {
  it("writes the cell and opens the next, wrapping to the next row", async () => {
    const { session, id, words, press, type, openCell } = await open();
    openCell(0, 2);
    type("a");
    press("Tab", { keyCode: 9 });
    expect(words()[0]?.[2]).toBe("a");
    expect(session.state.editing).toBe(id);
    expect(session.state.cells).toEqual(selectionAt(id, { row: 1, col: 0 }));
  });

  it("goes back with Shift", async () => {
    const { session, id, press, openCell } = await open();
    openCell(1, 0);
    press("Tab", { shiftKey: true, keyCode: 9 });
    expect(session.state.cells).toEqual(selectionAt(id, { row: 0, col: 2 }));
    expect(session.state.editing).toBe(id);
  });

  it("adds a row on the last cell and opens its first cell, so a table can be filled with the keyboard", async () => {
    const { session, id, grid, words, press, type, openCell } = await open();
    openCell(2, 2);
    type("last");
    press("Tab", { keyCode: 9 });
    expect(grid().rows).toHaveLength(4);
    expect(words()[2]?.[2]).toBe("last");
    expect(session.state.cells).toEqual(selectionAt(id, { row: 3, col: 0 }));
    expect(session.state.editing).toBe(id);
    type("new");
    press("Tab", { keyCode: 9 });
    expect(words()[3]).toEqual(["new", "", ""]);
  });
});

describe("the header row", () => {
  it("shows its open cell in bold without writing bold into the words", async () => {
    const { session, view, words, type, openCell } = await open();
    openCell(0, 1);
    expect(view.container.querySelector(".ks-cell-layer .ks-cell-header")).not.toBeNull();
    type("Title");
    act(() => session.stopEditing());
    const written = (session.slide.elements.find((e) => e.type === "table") as TableEl).rows[0]?.cells[1]?.text.paragraphs[0]?.runs[0];
    expect(written?.t).toBe("Title");
    expect(written?.b).toBeFalsy();
    expect(words()[0]?.[1]).toBe("Title");
  });

  it("is plain for the other rows", async () => {
    const { view, openCell } = await open();
    openCell(1, 1);
    expect(view.container.querySelector(".ks-cell-layer .ks-cell-header")).toBeNull();
  });
});

describe("moving on to another slide while a cell is open", () => {
  it("writes the cell on the slide it was opened on", async () => {
    const { session, id, words, type, openCell } = await open();
    const first = session.state.slideId;
    openCell(1, 1);
    type("stay");
    act(() => void session.slides.add({ layout: "blank" }));
    expect(session.state.slideId).not.toBe(first);
    session.goTo(first);
    expect(session.slide.elements.some((e) => e.id === id)).toBe(true);
    expect(words()[1]?.[1]).toBe("stay");
  });
});

describe("a letter typed with cells picked", () => {
  it("opens the cell with the letter in it", async () => {
    const { session, id, view, words } = await open();
    act(() => session.selectCells(selectionAt(id, { row: 1, col: 1 })));
    const stage = view.container.querySelector<HTMLElement>(".ks-stage")!;
    stage.focus();
    fireEvent.keyDown(stage, { key: "x" });
    expect(session.state.editing).toBe(id);
    act(() => session.stopEditing());
    expect(words()[1]?.[1]).toBe("x");
  });
});
