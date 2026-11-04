// The first click only selects: on a layout slot, a table, a locked element, a line (only near its path) and a pile of elements
// (a click again at the same point steps down). The menus that go with them: Unlock, Unlock all on slide, Select behind.

import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { line, shape, table, textBox } from "../factory.ts";
import type { SlidesHost } from "../host.ts";
import { contextItems } from "../menus/context-items.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { CanvasController, type PointerInfo } from "./controller.ts";
import { rememberMenuPoint } from "./stack.ts";

const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (n) => n, deliver: async () => {} };
const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1, client: { x: x + 1000, y: y + 500 }, ...extra });

async function setup(layout = "blank") {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
  const ui = new EditorUi();
  const controller = new CanvasController(session, ui, () => 1);
  session.slides.add({ layout });
  const click = (x: number, y: number, extra: Partial<PointerInfo> = {}) => {
    controller.down(at(x, y, extra), { kind: "surface" });
    controller.up(at(x, y, extra));
  };
  return { session, ui, controller, click };
}

describe("an empty layout slot", () => {
  it("is only selected by the first click, and opened by the next", async () => {
    const { session, click } = await setup("title-body");
    const slot = session.slide.elements.find((e) => e.placeholder === "body")!;
    const box = session.elements.boxOf(slot)!;
    const [x, y] = [box.x + box.w / 2, box.y + box.h / 2];
    click(x, y);
    expect(session.state.selection).toEqual([slot.id]);
    expect(session.state.editing).toBeNull();
    click(x, y);
    expect(session.state.editing).toBe(slot.id);
  });
});

describe("a table", () => {
  it("is selected whole by the first click, so Delete removes the table and no cells are picked", async () => {
    const { session, click } = await setup();
    const [id] = session.elements.insert([table(2, 2, { x: 100, y: 400, w: 300, h: 100 })]) as [string];
    session.select([]);
    click(150, 420);
    expect(session.state.selection).toEqual([id]);
    expect(session.state.cells).toBeNull();
    expect(session.state.editing).toBeNull();
  });

  it("picks the cell under the pointer on a click of the selected table, and opens it on a double click", async () => {
    const { session, controller, click } = await setup();
    const [id] = session.elements.insert([table(2, 2, { x: 100, y: 400, w: 300, h: 100 })]) as [string];
    session.select([]);
    click(150, 420);
    click(150, 420);
    expect(session.state.cells?.table).toBe(id);
    session.select([]);
    controller.doubleClick(at(250, 470, { detail: 2 }));
    expect(session.state.cells?.table).toBe(id);
    expect(session.state.editing).toBe(id);
  });
});

describe("a locked element", () => {
  it("is selected by a click and stays put under a drag, which draws a selection rectangle instead", async () => {
    const { session, controller, click } = await setup();
    const [id, free] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 400, h: 300 }), shape("rect", { x: 200, y: 150, w: 50, h: 50 })]) as [string, string];
    session.elements.lock(true, [id]);
    session.select([]);
    click(450, 350);
    expect(session.state.selection).toEqual([id]);
    controller.down(at(450, 350), { kind: "surface" });
    controller.move(at(480, 380));
    controller.up(at(480, 380));
    expect(session.slide.elements.find((e) => e.id === id)).toMatchObject({ x: 100, y: 100 });
    expect(session.slide.elements.find((e) => e.id === free)).toMatchObject({ x: 200, y: 150 });
  });

  it("shows Unlock in its menu, and the slide's menu has Unlock all on slide", async () => {
    const { session, ui, click } = await setup();
    const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 100, h: 100 }), shape("rect", { x: 300, y: 100, w: 100, h: 100 })]) as [string, string];
    session.elements.lock(true, [a, b]);
    click(150, 150);
    const labels = (kind: "element" | "canvas") => contextItems(kind, { session, ui }).flatMap((item) => ("label" in item ? [item.label] : []));
    expect(labels("element")).toContain("Unlock");
    const all = contextItems("canvas", { session, ui }).find((item) => "id" in item && item.id === "unlock-all");
    expect(all).toBeTruthy();
    (all as { run: () => void }).run();
    expect(session.slide.elements.every((e) => !e.locked)).toBe(true);
    expect(contextItems("canvas", { session, ui }).some((item) => "id" in item && item.id === "unlock-all")).toBe(false);
  });
});

describe("a line", () => {
  it("is hit near its path and not in the empty corner of its box", async () => {
    const { session, click } = await setup();
    const [id] = session.elements.insert([line("straight", false, { x: 100, y: 100 }, { x: 400, y: 300 })]) as [string];
    session.select([]);
    click(380, 120);
    expect(session.state.selection).toEqual([]);
    click(250, 200);
    expect(session.state.selection).toEqual([id]);
  });
});

describe("a pile of elements", () => {
  it("is stepped down by a click again at the same point, and round to the top", async () => {
    const { session, click } = await setup();
    const [back, middle, front] = session.elements.insert([
      shape("rect", { x: 100, y: 100, w: 300, h: 200 }),
      shape("ellipse", { x: 120, y: 120, w: 260, h: 160 }),
      shape("rect", { x: 140, y: 140, w: 220, h: 120 }),
    ]) as [string, string, string];
    session.select([]);
    click(250, 200);
    expect(session.state.selection).toEqual([front]);
    click(250, 200);
    expect(session.state.selection).toEqual([middle]);
    click(250, 200);
    expect(session.state.selection).toEqual([back]);
    click(250, 200);
    expect(session.state.selection).toEqual([front]);
  });

  it("starts again at the top when the click is somewhere else, or after another gesture", async () => {
    const { session, click } = await setup();
    const [back, front] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 300, h: 200 }), shape("rect", { x: 140, y: 140, w: 220, h: 120 })]) as [string, string];
    session.select([]);
    click(250, 200);
    click(300, 220);
    expect(session.state.selection).toEqual([front]);
    click(250, 200);
    click(120, 120);
    expect(session.state.selection).toEqual([back]);
    click(250, 200);
    expect(session.state.selection).toEqual([front]);
  });

  it("does not step down from a text box, whose second click is for writing", async () => {
    const { session, click } = await setup();
    const [, words] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 300, h: 200 }), textBox({ x: 140, y: 140, w: 220, h: 120 }, "Words")]) as [string, string];
    session.select([]);
    click(250, 200);
    click(250, 200);
    expect(session.state.selection).toEqual([words]);
    expect(session.state.editing).toBe(words);
  });

  it("is reached with Select behind in the menu", async () => {
    const { session, ui, click } = await setup();
    const [back] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 300, h: 200 }), shape("rect", { x: 140, y: 140, w: 220, h: 120 })]) as [string, string];
    session.select([]);
    click(250, 200);
    rememberMenuPoint(session, { x: 250, y: 200 }, 1);
    const row = contextItems("element", { session, ui }).find((item) => "id" in item && item.id === "select-behind");
    expect(row).toBeTruthy();
    (row as { run: () => void }).run();
    expect(session.state.selection).toEqual([back]);
  });
});
