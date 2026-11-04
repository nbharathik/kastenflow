// The text controls on a table that is selected but not open for writing: the size, font and marks reach the words of every cell, or of
// the cells picked, as one step of undo, and the controls show what those cells have.

import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { textOfWords } from "../clipboard/table.ts";
import { canFormat } from "../commands/format.ts";
import { table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";

type TableEl = Extract<Element, { type: "table" }>;

const at = (row: number, col: number) => ({ row, col });

async function filled() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  session.slides.add({ layout: "blank" });
  const [id] = session.elements.insert([table(2, 2, { x: 100, y: 100, w: 300, h: 150 })]) as [string];
  const cells = [0, 1].map((r) => [0, 1].map((c) => ({ text: textOfWords(`r${r}c${c}`) })));
  session.core.apply("set_cells", { slide: session.state.slideId, id, at: at(0, 0), cells });
  session.select([id]);
  const grid = () => session.slide.elements.find((e) => e.id === id) as TableEl;
  /** The size of the first run of each cell, row by row; undefined where the cell keeps its style's. */
  const sizes = () => grid().rows.map((row) => row.cells.map((cell) => cell.text.paragraphs[0]?.runs[0]?.size));
  return { session, id, sizes };
}

describe("the font size of a table", () => {
  it("can be set with the table selected", async () => {
    const { session } = await filled();
    expect(canFormat({ session, ui: new EditorUi() })).toBe(true);
  });

  it("goes on every cell when no cell is picked, as one step of undo", async () => {
    const { session, sizes } = await filled();
    session.text.setRun("size", 28);
    expect(sizes()).toEqual([
      [28, 28],
      [28, 28],
    ]);
    expect(session.text.state().size).toBe(28);
    session.undo();
    expect(sizes()).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("goes only on the cells picked: a row", async () => {
    const { session, id, sizes } = await filled();
    session.selectCells({ table: id, anchor: at(1, 0), focus: at(1, 1) });
    session.text.setRun("size", 12);
    expect(sizes()).toEqual([
      [undefined, undefined],
      [12, 12],
    ]);
  });

  it("shows mixed when the cells differ, and bold reaches the cells too", async () => {
    const { session, id } = await filled();
    session.selectCells({ table: id, anchor: at(0, 0), focus: at(0, 0) });
    session.text.setRun("size", 40);
    session.selectCells(null);
    session.select([id]);
    expect(session.text.state().size).toBe("mixed");
    session.text.toggle("b");
    expect(session.text.state().bold).toBe(true);
  });
});
