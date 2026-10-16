// @vitest-environment node

// The cell of a table that an editor draws over the slide is the only one whose words are left out, so the words of the others stay.

import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it, vi } from "vitest";

import { SlideView } from "./SlideView.tsx";
import { blocks, draw } from "./testing/dom.ts";
import { box, scene, words } from "./testing/decks.ts";

vi.mock("../text/TextBlock.tsx", () => import("./testing/mock-text-block.tsx"));

const cell = (t: string, extra: object = {}) => ({ text: words(t), ...extra });
const table = (id = "t", extra: Partial<Element> = {}): Element =>
  ({
    type: "table",
    id,
    ...box(60, 380, 400, 90),
    columns: [100, 100, 100, 100],
    rows: [{ cells: [cell("a", { colSpan: 2 }), cell("b"), cell("c")] }, { cells: [cell("d"), cell("e"), cell("f"), cell("g")] }],
    ...extra,
  }) as Element;

async function shown(hideCell: { id: string; row: number; col: number } | null, elements: Element[] = [table()], hideTextOf: string | null = null) {
  const { deck, slide } = await scene("blank", elements);
  const page = draw(<SlideView deck={deck} slide={slide} mode="edit" hideTextOf={hideTextOf} hideCell={hideCell} />);
  return blocks(page).map((block) => block.words);
}

describe("hiding the words of one cell", () => {
  it("draws every cell when none is hidden", async () => {
    expect(await shown(null)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("leaves out only the cell at that place", async () => {
    expect(await shown({ id: "t", row: 1, col: 2 })).toEqual(["a", "b", "c", "d", "e", "g"]);
    expect(await shown({ id: "t", row: 0, col: 3 })).toEqual(["a", "b", "d", "e", "f", "g"]);
  });

  it("takes a merged cell by its first place", async () => {
    expect(await shown({ id: "t", row: 0, col: 0 })).toEqual(["b", "c", "d", "e", "f", "g"]);
  });

  it("leaves other tables alone, and a table that is not there", async () => {
    const two = [table("t"), table("u", { y: 100 } as Partial<Element>)];
    expect(await shown({ id: "u", row: 0, col: 3 }, two)).toEqual(["a", "b", "c", "d", "e", "f", "g", "a", "b", "d", "e", "f", "g"]);
    expect(await shown({ id: "missing", row: 0, col: 0 })).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("reaches a table inside a group", async () => {
    const grouped = { type: "group", id: "g", children: [table("inner")] } as unknown as Element;
    expect(await shown({ id: "inner", row: 1, col: 0 }, [grouped])).toEqual(["a", "b", "c", "e", "f", "g"]);
  });

  it("hides every cell when the whole element's words are hidden, as for a text box", async () => {
    expect(await shown(null, [table()], "t")).toEqual([]);
  });
});
