// The paint format brush with tables: picked up from a cell, laid on the cells picked or on a whole table, in one step of undo, and
// laid when the pointer is let go rather than at the press.

import type { Element, Text } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { runCommand } from "../commands/index.ts";
import { shape, table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { selectionAt } from "../table/cells.ts";
import { EditorUi } from "../ui-state.ts";
import { applyPaint, capturePaint, usePaintBrush } from "./paint.ts";

type TableEl = Extract<Element, { type: "table" }>;

afterEach(cleanup);

function Brush({ session, ui }: { session: EditorSession; ui: EditorUi }) {
  usePaintBrush(session, ui);
  return null;
}

const at = (row: number, col: number) => ({ row, col });
const words = (t: string, extra: object = {}): Text => ({ paragraphs: [{ runs: [{ t, ...extra }] }] });

async function open() {
  const errors: string[] = [];
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000, onError: (m) => errors.push(m) });
  const ui = new EditorUi();
  session.slides.add({ layout: "blank" });
  const [id, other] = session.elements.insert([table(3, 3, { x: 100, y: 100, w: 300, h: 150 }), table(2, 2, { x: 100, y: 300, w: 200, h: 80 })]) as [string, string];
  const [styled] = session.elements.insert([shape("rect", { x: 600, y: 100, w: 100, h: 100 })]) as [string];
  session.select([]);
  const grid = (which = id) => session.slide.elements.find((e) => e.id === which) as TableEl;
  const runs = (which = id) => grid(which).rows.map((row) => row.cells.map((cell) => cell.text.paragraphs[0]?.runs[0]));
  const fills = (which = id) => grid(which).rows.map((row) => row.cells.map((cell) => cell.fill?.color ?? null));
  const fill = (cells: string[][]) =>
    session.core.apply("set_cells", { slide: session.state.slideId, id, at: at(0, 0), cells: cells.map((row) => row.map((t) => ({ text: words(t) }))) });
  return { session, ui, id, other, styled, errors, grid, runs, fills, fill, ctx: { session, ui } };
}

const bold = { run: { b: true, color: "accent2", highlight: "accent3" } };

describe("laying a brush on cells", () => {
  it("paints the cells picked and no others, in one step of undo", async () => {
    const { session, id, runs, fill } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    session.selectCells({ table: id, anchor: at(0, 1), focus: at(1, 2) });
    applyPaint(session, bold, [id]);
    const painted = { b: true, color: "accent2", highlight: "accent3" };
    expect(runs()).toEqual([
      [{ t: "a" }, { t: "b", ...painted }, { t: "c", ...painted }],
      [{ t: "d" }, { t: "e", ...painted }, { t: "f", ...painted }],
      [{ t: "g" }, { t: "h" }, { t: "i" }],
    ]);
    expect(session.state.undoLabel).toBe("set_cells");
    session.undo();
    expect(runs()[0]).toEqual([{ t: "a" }, { t: "b" }, { t: "c" }]);
  });

  it("paints every cell of a table when no cells are picked", async () => {
    const { session, id, runs, fill } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    applyPaint(session, { run: { i: true } }, [id]);
    expect(runs().flat().every((run) => run?.i === true)).toBe(true);
  });

  it("takes off what the brush lacks, as it does on a box", async () => {
    const { session, id, runs, fill } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    session.selectCells(selectionAt(id, at(0, 0)));
    applyPaint(session, bold, [id]);
    // A brush with no colour puts the text style's back, with no highlight takes it off, with bold off takes that off.
    applyPaint(session, { run: { b: false, highlight: null } }, [id]);
    expect(runs()[0]?.[0]).toEqual({ t: "a" });
    expect(runs()[0]?.[1]).toEqual({ t: "b" });
  });

  it("puts a merged cell's brush on its first place and leaves the places it covers, with no refusal", async () => {
    const { session, id, runs, fill, errors } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(0, 1) });
    session.tables.merge();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    applyPaint(session, { run: { b: true } }, [id]);
    expect(errors).toEqual([]);
    expect(session.state.undoLabel).toBe("set_cells");
    const merged = (session.slide.elements.find((e) => e.id === id) as TableEl).rows[0]?.cells[0];
    expect(merged?.text.paragraphs.every((p) => p.runs.every((r) => r.b === true || r.t === ""))).toBe(true);
    expect(runs()[1]?.slice(0, 2).every((run) => run?.b === true)).toBe(true);
  });

  it("changes nothing, and makes no step of undo, when the cells look as the brush says already", async () => {
    const { session, id, fill } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    const label = session.state.undoLabel;
    const revision = session.state.revision;
    applyPaint(session, { run: {} }, [id]);
    expect(session.state.revision).toBe(revision);
    expect(session.state.undoLabel).toBe(label);
  });
});

describe("the fill of a brush", () => {
  it("is laid on the cells picked with the engine's own operation, and a brush without a fill leaves fills alone", async () => {
    const { session, id, fills } = await open();
    session.selectCells({ table: id, anchor: at(1, 0), focus: at(1, 1) });
    applyPaint(session, { run: {}, style: { fill: { color: "accent4" } } }, [id]);
    expect(fills()).toEqual([[null, null, null], ["accent4", "accent4", null], [null, null, null]]);
    applyPaint(session, { run: { b: true } }, [id]);
    expect(fills()[1]).toEqual(["accent4", "accent4", null]);
    applyPaint(session, { run: {}, style: {} }, [id]);
    expect(fills()[1]).toEqual([null, null, null]);
  });

  it("goes in the same step as the words", async () => {
    const { session, id, runs, fills, fill } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    session.selectCells(selectionAt(id, at(2, 2)));
    applyPaint(session, { run: { b: true }, style: { fill: { color: "accent5" } } }, [id]);
    expect(runs()[2]?.[2]).toEqual({ t: "i", b: true });
    expect(fills()[2]?.[2]).toBe("accent5");
    session.undo();
    expect(runs()[2]?.[2]).toEqual({ t: "i" });
    expect(fills()[2]?.[2]).toBeNull();
  });
});

describe("picking a brush up from a table", () => {
  it("takes the looks and the fill of the cell the keys move from", async () => {
    const { session, id, ctx } = await open();
    session.core.apply("set_cells", { slide: session.state.slideId, id, at: at(1, 1), cells: [[{ text: words("x", { b: true, color: "accent2", size: 30 }) }]] });
    session.core.apply("set_cell_fill", { slide: session.state.slideId, id, from: at(1, 1), to: at(1, 1), fill: { color: "accent3" } });
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) });
    const brush = capturePaint(ctx);
    expect(brush?.run).toMatchObject({ b: true, color: "accent2", size: 30 });
    expect(brush?.style).toEqual({ fill: { color: "accent3" } });
  });

  it("takes the first cell of a table whose frame is what is selected", async () => {
    const { session, id, ctx } = await open();
    session.core.apply("set_cells", { slide: session.state.slideId, id, at: at(0, 0), cells: [[{ text: words("first", { i: true }) }]] });
    session.select([id]);
    expect(capturePaint(ctx)?.run).toMatchObject({ i: true });
  });

  it("is laid on a text box or a shape, which take the cell's fill", async () => {
    const { session, id, styled, ctx } = await open();
    session.core.apply("set_cell_fill", { slide: session.state.slideId, id, from: at(0, 0), to: at(0, 0), fill: { color: "accent4" } });
    session.selectCells(selectionAt(id, at(0, 0)));
    const brush = capturePaint(ctx)!;
    applyPaint(session, brush, [styled]);
    const rect = session.slide.elements.find((e) => e.id === styled);
    expect(rect?.style?.fill?.color).toBe("accent4");
  });

  it("is laid on another table", async () => {
    const { session, id, other, runs } = await open();
    session.core.apply("set_cells", { slide: session.state.slideId, id, at: at(0, 0), cells: [[{ text: words("src", { b: true, color: "accent1" }) }]] });
    session.selectCells(selectionAt(id, at(0, 0)));
    const brush = capturePaint({ session, ui: new EditorUi() })!;
    applyPaint(session, brush, [other]);
    expect(runs(other).flat().every((run) => run?.b === true && run.color === "accent1")).toBe(true);
  });
});

describe("the brush in hand", () => {
  it("is laid on the cell clicked when the pointer is let go, and put away", async () => {
    const { session, ui, id, runs, fill } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    render(<Brush session={session} ui={ui} />);
    act(() => ui.setPaint({ run: { b: true } }));
    // The press selects the table; the cell is picked as the pointer is let go.
    fireEvent.pointerDown(document.body);
    act(() => session.select([id]));
    expect(runs().flat().some((run) => run?.b)).toBe(false);
    act(() => session.selectCells(selectionAt(id, at(1, 1))));
    expect(runs().flat().some((run) => run?.b)).toBe(false);
    fireEvent.pointerUp(document.body);
    expect(runs().flat().filter((run) => run?.b).map((run) => run?.t)).toEqual(["e"]);
    expect(ui.state.paint).toBeNull();
  });

  it("is laid on the cells dragged over", async () => {
    const { session, ui, id, runs, fill } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    session.select([id]);
    render(<Brush session={session} ui={ui} />);
    act(() => ui.setPaint({ run: { i: true } }));
    fireEvent.pointerDown(document.body);
    act(() => session.selectCells(selectionAt(id, at(0, 0))));
    act(() => session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) }));
    fireEvent.pointerUp(document.body);
    expect(runs().flat().filter((run) => run?.i).map((run) => run?.t)).toEqual(["a", "b", "d", "e"]);
  });

  it("is laid at once on cells picked with the keys", async () => {
    const { session, ui, id, runs, fill } = await open();
    fill([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    session.selectCells(selectionAt(id, at(0, 0)));
    render(<Brush session={session} ui={ui} />);
    act(() => ui.setPaint({ run: { u: true } }));
    act(() => session.selectCells(selectionAt(id, at(0, 1))));
    expect(runs()[0]?.map((run) => run?.u)).toEqual([undefined, true, undefined]);
    expect(ui.state.paint).toBeNull();
  });

  it("is laid on the whole of a table that is selected without cells", async () => {
    const { session, ui, id, other, runs } = await open();
    session.select([id]);
    render(<Brush session={session} ui={ui} />);
    act(() => ui.setPaint({ run: { b: true } }));
    act(() => session.select([other]));
    expect(runs(other).flat().every((run) => run?.b === true)).toBe(true);
    expect(ui.state.paint).toBeNull();
  });

  it("still goes on a box the way it always did", async () => {
    const { session, ui, id, styled } = await open();
    session.select([id]);
    render(<Brush session={session} ui={ui} />);
    act(() => ui.setPaint({ run: {}, style: { fill: { color: "accent6" } } }));
    act(() => session.select([styled]));
    expect(session.slide.elements.find((e) => e.id === styled)?.style?.fill?.color).toBe("accent6");
    expect(ui.state.paint).toBeNull();
  });

  it("is put away by Escape without laying it", async () => {
    const { session, ui, id, other, runs } = await open();
    session.select([id]);
    render(<Brush session={session} ui={ui} />);
    act(() => ui.setPaint({ run: { b: true } }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    act(() => session.select([other]));
    expect(ui.state.paint).toBeNull();
    expect(runs(other).flat().some((run) => run?.b)).toBe(false);
  });
});

describe("Copy format and Paste format", () => {
  it("hold a format picked up with Copy format, and lay it as often as is wanted with Paste format", async () => {
    const { session, ui, id, other, runs, ctx } = await open();
    session.core.apply("set_cells", { slide: session.state.slideId, id, at: at(0, 0), cells: [[{ text: words("src", { b: true, color: "accent2" }) }]] });
    session.selectCells(selectionAt(id, at(0, 0)));
    await runCommand("text.paint-copy", ctx);
    expect(ui.state.heldFormat?.run).toMatchObject({ b: true, color: "accent2" });
    session.select([other]);
    await runCommand("text.paint-paste", ctx);
    expect(runs(other).flat().every((run) => run?.b === true)).toBe(true);
    // Held until something else is picked up.
    expect(ui.state.heldFormat).not.toBeNull();
    session.select([id]);
    session.selectCells(selectionAt(id, at(2, 2)));
    await runCommand("text.paint-paste", ctx);
    expect(runs()[2]?.[2]).toMatchObject({ b: true, color: "accent2" });
  });

  it("cannot paste a format that was not copied, or with nothing selected", async () => {
    const { session, ui, id, ctx } = await open();
    session.select([id]);
    const revision = session.state.revision;
    await runCommand("text.paint-paste", ctx);
    expect(session.state.revision).toBe(revision);
    ui.setHeldFormat({ run: { b: true } });
    session.select([]);
    await runCommand("text.paint-paste", ctx);
    expect(session.state.revision).toBe(revision);
  });

  it("are on Ctrl+Alt+C and Ctrl+Alt+V, and the brush command has no key of its own", async () => {
    const { COMMANDS } = await import("../commands/index.ts");
    expect(COMMANDS.get("text.paint-copy")?.keys).toEqual(["Mod+Alt+C"]);
    expect(COMMANDS.get("text.paint-paste")?.keys).toEqual(["Mod+Alt+V"]);
    expect(COMMANDS.get("format.paint")?.keys).toBeUndefined();
  });

  it("the brush command puts the brush in hand and away again", async () => {
    const { session, ui, id, ctx } = await open();
    session.select([id]);
    await runCommand("format.paint", ctx);
    expect(ui.state.paint).not.toBeNull();
    await runCommand("format.paint", ctx);
    expect(ui.state.paint).toBeNull();
  });
});
