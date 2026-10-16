// Copy, cut and paste when cells are picked in a table: they are about the cells, with a spreadsheet's text and tables on the clipboard.
// The blocks and slides that Kasten copied are a different clipboard and are left as they were.

import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../commands/index.ts";
import { shape, table } from "../factory.ts";
import { openDeck } from "../filmstrip/test-support.ts";
import { Workspace } from "../SlidesEditor.tsx";
import { selectionAt } from "../table/cells.ts";
import { KASTEN_TYPE } from "./format.ts";
import { forget, latest } from "./store.ts";

type TableEl = Extract<Element, { type: "table" }>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(forget);

function transfer(initial: Record<string, string> = {}, files: File[] = []) {
  const data = new Map(Object.entries(initial));
  return { getData: (type: string) => data.get(type) ?? "", setData: (type: string, value: string) => void data.set(type, value), files, data };
}

const at = (row: number, col: number) => ({ row, col });

async function open() {
  const made = await openDeck({ slides: 2 });
  const { session } = made;
  session.slides.add({ layout: "blank" });
  const [id, other] = session.elements.insert([table(3, 3, { x: 100, y: 100, w: 300, h: 150 }), shape("rect", { x: 500, y: 100, w: 100, h: 100 })]) as [string, string];
  session.select([]);
  const view = render(<Workspace session={session} ui={made.ui} />);
  const stage = () => view.container.querySelector<HTMLElement>(".ks-stage")!;
  const grid = () => session.slide.elements.find((e) => e.id === id) as TableEl;
  const words = () => grid().rows.map((row) => row.cells.map((cell) => cell.text.paragraphs.map((p) => p.runs.map((r) => r.t).join("")).join("\n")));
  const fill = (rows: string[][]) =>
    session.core.apply("set_cells", { slide: session.state.slideId, id, at: at(0, 0), cells: rows.map((row) => row.map((t) => ({ text: { paragraphs: [{ runs: [{ t }] }] } }))) });
  return { ...made, view, stage, id, other, grid, words, fill, ctx: { session, ui: made.ui } };
}

describe("a copy of cells", () => {
  it("puts the words as tab separated text and a table that carries the cells, and not the Kasten type of blocks", async () => {
    const made = await open();
    made.fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    act(() => made.session.selectCells({ table: made.id, anchor: at(0, 1), focus: at(1, 2) }));
    const data = transfer();
    const dispatched = fireEvent.copy(made.stage(), { clipboardData: data });
    expect(dispatched, "the event is taken").toBe(false);
    expect(data.data.get("text/plain")).toBe("b\tc\r\ne\tf");
    expect(data.data.get("text/html")).toMatch(/^<table data-kasten-cells="[A-Za-z0-9+/=]+">/);
    expect(data.data.has(KASTEN_TYPE)).toBe(false);
  });

  it("leaves what was last copied as blocks alone", async () => {
    const made = await open();
    act(() => made.session.select([made.other]));
    fireEvent.copy(made.stage(), { clipboardData: transfer() });
    const blocks = latest();
    expect(blocks?.kind).toBe("elements");
    act(() => made.session.selectCells(selectionAt(made.id, at(0, 0))));
    fireEvent.copy(made.stage(), { clipboardData: transfer() });
    expect(latest()).toBe(blocks);
  });

  it("is a cut that empties the cells once they are on the event, in one step of undo", async () => {
    const made = await open();
    made.fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    act(() => made.session.selectCells({ table: made.id, anchor: at(0, 0), focus: at(0, 1) }));
    const data = transfer();
    fireEvent.cut(made.stage(), { clipboardData: data });
    expect(data.data.get("text/plain")).toBe("a\tb");
    expect(made.words()[0]).toEqual(["", "", "c"]);
    expect(made.session.slide.elements.some((e) => e.id === made.id)).toBe(true);
    act(() => made.session.undo());
    expect(made.words()[0]).toEqual(["a", "b", "c"]);
  });

  it("is about the blocks again once the frame is what is selected", async () => {
    const made = await open();
    act(() => made.session.selectCells(selectionAt(made.id, at(0, 0))));
    act(() => made.session.selectCells(null));
    const data = transfer();
    fireEvent.copy(made.stage(), { clipboardData: data });
    expect(data.data.has(KASTEN_TYPE)).toBe(true);
  });
});

describe("a paste into cells", () => {
  it("takes a spreadsheet's text, from the cell picked, adding what it needs, in one step of undo", async () => {
    const made = await open();
    act(() => made.session.selectCells(selectionAt(made.id, at(1, 1))));
    const count = made.session.state.revision;
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "1\t2\t3\r\n4\t5\t6\r\n" }) });
    expect(made.session.state.revision).toBe(count + 1);
    expect(made.grid().columns).toHaveLength(4);
    expect(made.words()[1]).toEqual(["", "1", "2", "3"]);
    expect(made.words()[2]).toEqual(["", "4", "5", "6"]);
    expect(made.session.state.cells).toEqual({ table: made.id, anchor: at(1, 1), focus: at(2, 3) });
    act(() => made.session.undo());
    expect(made.grid().columns).toHaveLength(3);
    expect(made.words()[1]).toEqual(["", "", ""]);
  });

  it("reads a cell with a line break in it, as Excel quotes it", async () => {
    const made = await open();
    act(() => made.session.selectCells(selectionAt(made.id, at(0, 0))));
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": '"first\nsecond"\tnext\r\n' }) });
    expect(made.words()[0]).toEqual(["first\nsecond", "next", ""]);
  });

  it("takes a table in HTML before the text beside it, spans leaving empty places", async () => {
    const made = await open();
    act(() => made.session.selectCells(selectionAt(made.id, at(0, 0))));
    const html = '<table><tr><td colspan="2">wide</td><td>end</td></tr><tr><td>x</td><td>y</td><td>z</td></tr></table>';
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/html": html, "text/plain": "ignored" }) });
    expect(made.words().slice(0, 2)).toEqual([["wide", "", "end"], ["x", "y", "z"]]);
  });

  it("drops a script and an event handler in pasted HTML, and writes only its words", async () => {
    const made = await open();
    act(() => made.session.selectCells(selectionAt(made.id, at(0, 0))));
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/html": '<table><tr><td onclick="x()">safe<script>window.pwned = 1</script><img src=x onerror="window.pwned = 2"></td></tr></table>' }) });
    expect(made.words()[0]?.[0]).toBe("safe");
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("returns cells copied here with their looks", async () => {
    const made = await open();
    made.session.core.apply("set_cells", { slide: made.session.state.slideId, id: made.id, at: at(0, 0), cells: [[{ text: { paragraphs: [{ runs: [{ t: "bold", b: true, color: "accent2" }] }] } }]] });
    act(() => made.session.selectCells(selectionAt(made.id, at(0, 0))));
    const data = transfer();
    fireEvent.copy(made.stage(), { clipboardData: data });
    act(() => made.session.selectCells(selectionAt(made.id, at(2, 2))));
    fireEvent.paste(made.stage(), { clipboardData: data });
    const run = made.grid().rows[2]?.cells[2]?.text.paragraphs[0]?.runs[0];
    expect(run).toMatchObject({ t: "bold", b: true, color: "accent2" });
  });

  it("puts a block of Kasten's own where blocks go, and lets the cells go", async () => {
    const made = await open();
    act(() => made.session.select([made.other]));
    const copied = transfer();
    fireEvent.copy(made.stage(), { clipboardData: copied });
    act(() => made.session.selectCells(selectionAt(made.id, at(1, 1))));
    const before = made.words();
    fireEvent.paste(made.stage(), { clipboardData: copied });
    expect(made.words()).toEqual(before);
    expect(made.session.slide.elements.filter((e) => e.type === "shape")).toHaveLength(2);
    expect(made.session.state.cells).toBeNull();
  });

  it("is refused in words when it would cut a merged cell, and changes nothing", async () => {
    const made = await open();
    act(() => made.session.selectCells({ table: made.id, anchor: at(1, 0), focus: at(2, 0) }));
    act(() => made.session.tables.merge());
    const before = made.words();
    act(() => made.session.selectCells(selectionAt(made.id, at(0, 0))));
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "a\nb\nc" }) });
    expect(made.words()).toEqual(before);
    expect(made.errors.join(" ")).toMatch(/merged cell/i);
  });

  it("is the text editor's while a cell is open for writing", async () => {
    const made = await open();
    act(() => made.session.startEditingCell(selectionAt(made.id, at(0, 0))));
    const before = made.words();
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "a\tb" }) });
    expect(made.words()).toEqual(before);
  });
});

describe("the Edit menu and the keys", () => {
  it("Copy and Paste from the menu work on the cells", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => void written.push(text), readText: async () => written[written.length - 1] ?? "" } });
    const made = await open();
    made.fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    made.stage().focus();
    act(() => made.session.selectCells({ table: made.id, anchor: at(0, 0), focus: at(0, 2) }));
    await act(async () => runCommand("edit.copy", made.ctx));
    expect(written).toEqual(["a\tb\tc"]);
    act(() => made.session.selectCells(selectionAt(made.id, at(2, 0))));
    await act(async () => runCommand("edit.paste", made.ctx));
    expect(made.words()[2]).toEqual(["a", "b", "c"]);
  });

  it("Cut from the menu empties the cells after the copy is on the clipboard", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => void written.push(text), readText: async () => "" } });
    const made = await open();
    made.fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    made.stage().focus();
    act(() => made.session.selectCells(selectionAt(made.id, at(1, 1))));
    await act(async () => runCommand("edit.cut", made.ctx));
    expect(written).toEqual(["e"]);
    expect(made.words()[1]).toEqual(["d", "", "f"]);
  });

  it("does not take the keys of the clipboard: the browser's events do the work", async () => {
    const made = await open();
    act(() => made.session.selectCells(selectionAt(made.id, at(0, 0))));
    made.stage().focus();
    expect(fireEvent.keyDown(made.stage(), { key: "c", code: "KeyC", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(made.stage(), { key: "v", code: "KeyV", ctrlKey: true })).toBe(true);
  });
});
