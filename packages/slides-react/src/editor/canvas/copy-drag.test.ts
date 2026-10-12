// Alt or Ctrl held while dragging copies instead of moving; a Ctrl click that goes nowhere still toggles; the controller says
// when a gesture begins, ends or is called off.

import { describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape } from "../factory.ts";
import type { SlidesHost } from "../host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { CanvasController, type PointerInfo } from "./controller.ts";

const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (n) => n, deliver: async () => {} };
const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1, ...extra });

async function setup() {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
  const ui = new EditorUi();
  ui.toggleSnap();
  const controller = new CanvasController(session, ui, () => 1);
  const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 }), shape("ellipse", { x: 500, y: 300, w: 120, h: 120 })]) as [string, string];
  session.select([]);
  return { session, ui, controller, a, b };
}

const drag = (c: CanvasController, from: [number, number], to: [number, number], mods: Partial<PointerInfo> = {}) => {
  c.down(at(...from, mods), { kind: "surface" });
  for (let i = 1; i <= 4; i++) c.move(at(from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4, mods));
  c.up(at(...to, mods));
};

describe("dragging with Alt or Ctrl", () => {
  it("leaves the element and puts a copy where the pointer went, as one step of undo, with the copy selected", async () => {
    const { session, controller, a } = await setup();
    const count = session.slide.elements.length;
    const revision = session.state.revision;
    drag(controller, [150, 150], [250, 190], { alt: true });
    expect(session.slide.elements).toHaveLength(count + 1);
    expect(session.slide.elements.find((e) => e.id === a)).toMatchObject({ x: 100, y: 100 });
    const copy = session.slide.elements.at(-1)!;
    expect(copy).toMatchObject({ type: "shape", x: 200, y: 140, w: 200, h: 100 });
    expect(session.state.selection).toEqual([copy.id]);
    expect(session.state.revision).toBe(revision + 1);
    session.undo();
    expect(session.slide.elements).toHaveLength(count);
  });

  it("copies with Ctrl too, and every element of a selection", async () => {
    const { session, controller, a, b } = await setup();
    session.select([a, b]);
    const count = session.slide.elements.length;
    drag(controller, [150, 150], [170, 130], { mod: true });
    expect(session.slide.elements).toHaveLength(count + 2);
    expect(session.slide.elements.find((e) => e.id === a)).toMatchObject({ x: 100, y: 100 });
    expect(session.slide.elements.find((e) => e.id === b)).toMatchObject({ x: 500, y: 300 });
    expect(session.slide.elements.slice(-2)).toMatchObject([{ x: 120, y: 80 }, { x: 520, y: 280 }]);
  });

  it("shows the copy being made while the keys are held, and not when they are let go", async () => {
    const { controller } = await setup();
    controller.down(at(150, 150, { alt: true }), { kind: "surface" });
    controller.move(at(190, 170, { alt: true }));
    expect(controller.preview.copy).toBe(true);
    controller.move(at(210, 190));
    expect(controller.preview.copy).toBe(false);
    controller.cancel();
  });

  it("moves, as it did, when the keys are let go before the end", async () => {
    const { session, controller, a } = await setup();
    const count = session.slide.elements.length;
    controller.down(at(150, 150, { alt: true }), { kind: "surface" });
    controller.move(at(190, 170, { alt: true }));
    controller.move(at(210, 190));
    controller.up(at(210, 190));
    expect(session.slide.elements).toHaveLength(count);
    expect(session.slide.elements.find((e) => e.id === a)).toMatchObject({ x: 160, y: 140 });
  });

  it("does not copy a plain click", async () => {
    const { session, controller } = await setup();
    const count = session.slide.elements.length;
    controller.down(at(150, 150, { alt: true }), { kind: "surface" });
    controller.up(at(150, 150, { alt: true }));
    expect(session.slide.elements).toHaveLength(count);
  });
});

describe("clicking with Ctrl", () => {
  it("adds what is not selected, takes out what is, and keeps what a drag copies", async () => {
    const { session, controller, a, b } = await setup();
    controller.down(at(150, 150), { kind: "surface" });
    controller.up(at(150, 150));
    controller.down(at(560, 360, { mod: true }), { kind: "surface" });
    controller.up(at(560, 360, { mod: true }));
    expect(session.state.selection).toEqual([a, b]);
    controller.down(at(150, 150, { mod: true }), { kind: "surface" });
    controller.up(at(150, 150, { mod: true }));
    expect(session.state.selection).toEqual([b]);
  });
});

describe("what a gesture says of itself", () => {
  it("tells those who watch the kind of gesture when one begins and ends, not for each step", async () => {
    const { controller } = await setup();
    let told = 0;
    controller.subscribeGesture(() => (told += 1));
    controller.down(at(150, 150), { kind: "surface" });
    controller.move(at(160, 160));
    expect(controller.getGesture()).toBe("move");
    const afterFirst = told;
    controller.move(at(170, 170));
    controller.move(at(180, 180));
    expect(told).toBe(afterFirst);
    controller.up(at(180, 180));
    expect(controller.getGesture()).toBeNull();
    expect(told).toBe(afterFirst + 1);
  });

  it("marks a gesture called off, so what was shown can glide back, and not one that finished", async () => {
    const { controller } = await setup();
    controller.down(at(150, 150), { kind: "surface" });
    controller.move(at(190, 170));
    controller.cancel();
    expect(controller.preview.cancelled).toBe(true);
    controller.down(at(150, 150), { kind: "surface" });
    controller.move(at(190, 170));
    controller.up(at(190, 170));
    expect(controller.preview.cancelled).toBeUndefined();
  });
});
