// Adding and taking away the last row or column of tables, through the engine's own operations.

import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { newDeck } from "../../../test/engine.ts";
import { table } from "../../factory.ts";
import { MemoryHost } from "../../memory-host.ts";
import { EditorSession } from "../../session/session.ts";
import { addAtEnd, canShrink, removeAtEnd } from "./table-edit.ts";

type TableEl = Extract<Element, { type: "table" }>;

async function open(sizes: [number, number][] = [[3, 3]]) {
  const errors: string[] = [];
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000, onError: (m) => errors.push(m) });
  session.slides.add({ layout: "blank" });
  const ids = session.elements.insert(sizes.map(([rows, columns], i) => table(rows, columns, { x: 50, y: 50 + i * 200, w: columns * 100, h: rows * 40 }))) as string[];
  const grid = (id: string) => session.slide.elements.find((e) => e.id === id) as TableEl;
  return { session, ids, grid, errors };
}

describe("adding at the end", () => {
  it("puts a row or a column last in each table, and the table grows by it", async () => {
    const { session, ids, grid, errors } = await open([[3, 3], [2, 4]]);
    addAtEnd(session, ids.map(grid), "row");
    expect(ids.map((id) => grid(id).rows.length)).toEqual([4, 3]);
    expect(grid(ids[0] as string).h).toBe(160);
    addAtEnd(session, ids.map(grid), "column");
    expect(ids.map((id) => grid(id).columns.length)).toEqual([4, 5]);
    expect(grid(ids[1] as string).w).toBe(500);
    expect(errors).toEqual([]);
  });

  it("is one step of undo for all the tables", async () => {
    const { session, ids, grid } = await open([[3, 3], [2, 4]]);
    addAtEnd(session, ids.map(grid), "row");
    session.undo();
    expect(ids.map((id) => grid(id).rows.length)).toEqual([3, 2]);
  });

  it("does nothing for no tables", async () => {
    const { session } = await open();
    const revision = session.state.revision;
    addAtEnd(session, [], "row");
    expect(session.state.revision).toBe(revision);
  });
});

describe("taking away at the end", () => {
  it("takes the last row or column of each table, and the table gets smaller by it", async () => {
    const { session, ids, grid } = await open([[3, 4]]);
    removeAtEnd(session, ids.map(grid), "row");
    expect(grid(ids[0] as string).rows).toHaveLength(2);
    expect(grid(ids[0] as string).h).toBe(80);
    removeAtEnd(session, ids.map(grid), "column");
    expect(grid(ids[0] as string).columns).toHaveLength(3);
    expect(grid(ids[0] as string).w).toBe(300);
  });

  it("leaves a table that has only one row or column, and takes from the others", async () => {
    const { session, ids, grid, errors } = await open([[1, 3], [3, 3]]);
    expect(canShrink(grid(ids[0] as string), "row")).toBe(false);
    expect(canShrink(grid(ids[1] as string), "row")).toBe(true);
    removeAtEnd(session, ids.map(grid), "row");
    expect(ids.map((id) => grid(id).rows.length)).toEqual([1, 2]);
    expect(errors).toEqual([]);
  });
});
