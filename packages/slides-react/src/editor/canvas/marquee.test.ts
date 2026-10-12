// The selection rectangle: it starts over a slot nothing is in, takes what it touches when Alt is held, and
// selects when the pointer is let go rather than at every step of the drag.

import { describe, expect, it } from "vitest";

import { shape } from "../factory.ts";
import { newDeck } from "../../test/engine.ts";
import type { SlidesHost } from "../host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { CanvasController, type PointerInfo } from "./controller.ts";
import { isEmptyPlaceholder } from "./empty.ts";

const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (n) => n, deliver: async () => {} };

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1, ...extra });

/** A slide of the title and body layout, its slots empty, and a box on top of them. */
async function setup() {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
  const ui = new EditorUi();
  ui.toggleSnap();
  const controller = new CanvasController(session, ui, () => 1);
  session.slides.add({ layout: "title-body" });
  const [box] = session.elements.insert([shape("rect", { x: 100, y: 200, w: 100, h: 100 })]) as [string];
  session.select([]);
  const slot = (role: string) => session.slide.elements.find((e) => e.placeholder === role)!.id;
  return { session, controller, box, title: slot("title"), body: slot("body") };
}

const drag = (c: CanvasController, from: [number, number], to: [number, number], mods: Partial<PointerInfo> = {}) => {
  c.down(at(...from, mods), { kind: "surface" });
  c.move(at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, mods));
  c.move(at(...to, mods));
  c.up(at(...to, mods));
};

describe("an empty slot", () => {
  it("is a slot of the layout with nothing in it", async () => {
    const { session, box, body } = await setup();
    expect(isEmptyPlaceholder(session.slide.elements.find((e) => e.id === body))).toBe(true);
    expect(isEmptyPlaceholder(session.slide.elements.find((e) => e.id === box))).toBe(false);
  });

  it("is no slot any more once there are words in it", async () => {
    const { session, body } = await setup();
    const element = session.slide.elements.find((e) => e.id === body)!;
    const filled = { ...element, text: { paragraphs: [{ runs: [{ t: "words" }] }] } };
    expect(isEmptyPlaceholder(filled as typeof element)).toBe(false);
  });
});

describe("a press on an empty slot", () => {
  it("starts a selection rectangle when it is dragged, and selects only what the rectangle holds", async () => {
    const { session, controller, box, body } = await setup();
    // The body slot covers (64, 148) to (896, 492): a press at (80, 190) is on it.
    drag(controller, [80, 190], [320, 330]);
    expect(session.state.selection).toEqual([box]);
    expect(session.state.selection).not.toContain(body);
    // A rectangle that holds nothing selects nothing; the slot under it is not taken.
    drag(controller, [400, 250], [600, 400]);
    expect(session.state.selection).toEqual([]);
  });

  it("selects the slot when it is only clicked", async () => {
    const { session, controller, body } = await setup();
    controller.down(at(500, 300), { kind: "surface" });
    controller.up(at(500, 300));
    expect(session.state.selection).toEqual([body]);
    // Shift takes it away again, as it does for any element.
    controller.down(at(500, 300, { shift: true }), { kind: "surface" });
    controller.up(at(500, 300, { shift: true }));
    expect(session.state.selection).toEqual([]);
  });

  it("is still opened for typing by a double click", async () => {
    const { session, controller, body } = await setup();
    controller.down(at(500, 300), { kind: "surface" });
    controller.up(at(500, 300));
    controller.doubleClick(at(500, 300, { detail: 2 }));
    expect(session.state.editing).toBe(body);
  });

  it("is a plain element once something is selected in it: pressing and pulling moves it", async () => {
    const { session, controller, body } = await setup();
    session.select([body]);
    const before = session.elements.boxOf(session.slide.elements.find((e) => e.id === body)!)!;
    drag(controller, [500, 300], [540, 340]);
    const after = session.elements.boxOf(session.slide.elements.find((e) => e.id === body)!)!;
    expect([after.x - before.x, after.y - before.y]).toEqual([40, 40]);
  });
});

describe("the rectangle", () => {
  it("outlines what it would take while it is dragged, and selects when the pointer is let go", async () => {
    const { session, controller, box } = await setup();
    const revision = session.state.revision;
    controller.down(at(80, 190), { kind: "surface" });
    controller.move(at(200, 260));
    controller.move(at(320, 330));
    expect(controller.preview.marquee).not.toBeNull();
    expect(controller.preview.hits).toEqual([box]);
    // Nothing else was drawn again for the drag: the selection is what it was.
    expect(session.state.selection).toEqual([]);
    controller.up(at(320, 330));
    expect(session.state.selection).toEqual([box]);
    expect(controller.preview.hits).toEqual([]);
    expect(session.state.revision).toBe(revision);
  });

  it("takes whatever it touches when Alt is held, but never an empty slot", async () => {
    const { session, controller, box } = await setup();
    // Held whole it takes nothing: the box reaches past it.
    drag(controller, [80, 190], [150, 250]);
    expect(session.state.selection).toEqual([]);
    drag(controller, [80, 190], [150, 250], { alt: true });
    expect(session.state.selection).toEqual([box]);
  });

  it("adds to what is selected with Shift", async () => {
    const { session, controller, box, title } = await setup();
    session.select([title]);
    drag(controller, [80, 190], [320, 330], { shift: true });
    expect(session.state.selection).toEqual([title, box]);
  });
});
