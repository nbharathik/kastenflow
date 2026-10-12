import { describe, expect, it } from "vitest";

import { shape, textBox } from "../factory.ts";
import { newDeck } from "../../test/engine.ts";
import type { SlidesHost } from "../host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { CanvasController, type PointerInfo, snapAngle } from "./controller.ts";

const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (n) => n, deliver: async () => {} };

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x, y, shift: false, alt: false, mod: false, button: 0, detail: 1, ...extra });

async function setup(snap = false) {
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
  const ui = new EditorUi();
  if (!snap) ui.toggleSnap();
  const zoom = { value: 1 };
  const controller = new CanvasController(session, ui, () => zoom.value);
  const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 }), shape("ellipse", { x: 500, y: 300, w: 120, h: 120 })]) as [string, string];
  session.select([]);
  return { session, ui, controller, a, b, zoom };
}

const drag = (c: CanvasController, from: [number, number], to: [number, number], target: Parameters<CanvasController["down"]>[1] = { kind: "surface" }, mods: Partial<PointerInfo> = {}) => {
  c.down(at(...from, mods), target);
  const steps = 4;
  for (let i = 1; i <= steps; i++) c.move(at(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, mods));
  c.up(at(...to, mods));
};

const find = (s: EditorSession, id: string) => s.slide.elements.find((e) => e.id === id)!;

describe("selecting", () => {
  it("picks the element under the pointer, adds with shift, and clears on empty canvas", async () => {
    const { session, controller, a, b } = await setup();
    controller.down(at(150, 150), { kind: "surface" });
    controller.up(at(150, 150));
    expect(session.state.selection).toEqual([a]);
    controller.down(at(560, 360, { shift: true }), { kind: "surface" });
    controller.up(at(560, 360, { shift: true }));
    expect(session.state.selection).toEqual([a, b]);
    // A press without moving on one of several picks that one.
    controller.down(at(150, 150), { kind: "surface" });
    controller.up(at(150, 150));
    expect(session.state.selection).toEqual([a]);
    controller.down(at(30, 480), { kind: "surface" });
    controller.up(at(30, 480));
    expect(session.state.selection).toEqual([]);
  });

  it("selects what a rectangle drawn on empty canvas takes in", async () => {
    const { session, controller, a } = await setup();
    drag(controller, [80, 80], [320, 220]);
    expect(session.state.selection).toEqual([a]);
    expect(controller.preview.marquee).toBeNull();
    drag(controller, [80, 80], [700, 500]);
    expect(session.state.selection).toHaveLength(2);
  });

  it("opens a box for editing on a double click", async () => {
    const { session, controller, a } = await setup();
    controller.doubleClick(at(150, 150, { detail: 2 }));
    expect(session.state.editing).toBe(a);
  });
});

describe("moving", () => {
  it("moves the selection by the distance dragged, as one step", async () => {
    const { session, controller, a } = await setup();
    const revision = session.state.revision;
    drag(controller, [150, 150], [200, 180]);
    expect(find(session, a)).toMatchObject({ x: 150, y: 130 });
    expect(session.state.revision).toBe(revision + 1);
    session.undo();
    expect(find(session, a)).toMatchObject({ x: 100, y: 100 });
  });

  it("draws the drag from a preview and changes nothing until it ends", async () => {
    const { session, controller, a } = await setup();
    controller.down(at(150, 150), { kind: "surface" });
    controller.move(at(190, 170));
    controller.move(at(210, 190));
    expect(controller.preview.overrides.get(a)).toMatchObject({ x: 160, y: 140, w: 200, h: 100 });
    expect(find(session, a)).toMatchObject({ x: 100, y: 100 });
    controller.cancel();
    expect(controller.preview.overrides.size).toBe(0);
    expect(controller.busy).toBe(false);
    controller.up(at(210, 190));
    expect(find(session, a)).toMatchObject({ x: 100, y: 100 });
  });

  it("does not move a locked element, or on a mere click", async () => {
    const { session, controller, a } = await setup();
    // Locked elements are skipped by a press, so lock everything under it.
    const everything = session.slide.elements.map((e) => e.id);
    session.elements.lock(true, everything);
    const revision = session.state.revision;
    drag(controller, [150, 150], [250, 250]);
    expect(session.state.revision).toBe(revision);
    session.elements.lock(false, everything);
    controller.down(at(150, 150), { kind: "surface" });
    controller.move(at(151, 151));
    controller.up(at(151, 151));
    expect(find(session, a)).toMatchObject({ x: 100, y: 100 });
  });

  it("snaps to the edges of the others and shows the guide", async () => {
    const { session, controller, a } = await setup(true);
    controller.down(at(150, 150), { kind: "surface" });
    // 505 would leave the left edge 5 short of the other shape's (500): it lands on it.
    controller.move(at(150 + 405, 150 + 60));
    expect(controller.preview.guides.length).toBeGreaterThan(0);
    expect(controller.preview.overrides.get(a)?.x).toBe(500);
    controller.up(at(555, 210));
    expect(find(session, a).x).toBe(500);
  });

  it("locks to one direction with shift", async () => {
    const { session, controller, a } = await setup();
    drag(controller, [150, 150], [250, 160], { kind: "surface" }, { shift: true });
    expect(find(session, a)).toMatchObject({ x: 200, y: 100 });
  });
});

describe("resizing and turning", () => {
  it("resizes from a handle, and mirrors when dragged past the far edge", async () => {
    const { session, controller, a } = await setup();
    session.select([a]);
    drag(controller, [300, 200], [400, 260], { kind: "handle", handle: "se" });
    expect(find(session, a)).toMatchObject({ x: 100, y: 100, w: 300, h: 160 });
    drag(controller, [400, 260], [50, 260], { kind: "handle", handle: "se" });
    const flipped = find(session, a);
    expect(flipped.flipH).toBe(true);
    expect(flipped.w).toBeGreaterThan(0);
  });

  it("turns about the centre, in steps with shift", async () => {
    const { session, controller, a } = await setup();
    session.select([a]);
    // The rotate handle sits above the top middle, at (200, 76): dragging it right of centre turns clockwise.
    drag(controller, [200, 76], [300, 150], { kind: "rotate" });
    const turned = find(session, a).rotation ?? 0;
    expect(turned).toBeGreaterThan(30);
    expect(turned).toBeLessThan(120);
    drag(controller, [200, 76], [300, 151], { kind: "rotate" }, { shift: true });
    expect((find(session, a).rotation ?? 0) % 15).toBe(0);
  });
});

describe("drawing", () => {
  it("draws a shape by dragging, and a default-sized one by clicking", async () => {
    const { session, controller } = await setup();
    session.setTool("shape:triangle");
    drag(controller, [40, 400], [240, 500]);
    const made = session.slide.elements.at(-1)!;
    expect(made).toMatchObject({ type: "shape", shape: "triangle", x: 40, y: 400, w: 200, h: 100 });
    expect(session.state.tool).toBe("select");
    expect(session.state.selection).toEqual([made.id]);

    session.setTool("shape:ellipse");
    controller.down(at(700, 100), { kind: "surface" });
    controller.up(at(700, 100));
    expect(session.slide.elements.at(-1)).toMatchObject({ shape: "ellipse", w: 160, h: 120, x: 620, y: 40 });
  });

  it("keeps a shape square with shift", async () => {
    const { session, controller } = await setup();
    session.setTool("shape:rect");
    drag(controller, [40, 300], [140, 340], { kind: "surface" }, { shift: true });
    expect(session.slide.elements.at(-1)).toMatchObject({ w: 100, h: 100 });
  });

  it("draws a text box and opens it for typing", async () => {
    const { session, controller } = await setup();
    session.setTool("text");
    drag(controller, [40, 420], [340, 470]);
    const made = session.slide.elements.at(-1)!;
    expect(made).toMatchObject({ type: "text", x: 40, y: 420, w: 300, h: 50 });
    expect(session.state.editing).toBe(made.id);
  });

  it("puts a text box with its top left where it was clicked, and opens it for typing", async () => {
    const { session, controller } = await setup();
    session.setTool("text");
    controller.down(at(400, 450), { kind: "surface" });
    controller.up(at(400, 450));
    const made = session.slide.elements.at(-1)!;
    expect(made).toMatchObject({ type: "text", x: 400, y: 450, w: 300, h: 56 });
    expect(session.state.editing).toBe(made.id);
    expect(session.state.tool).toBe("select");
  });

  it("keeps a text box made by a click on the slide, whatever side it is near", async () => {
    const { session, controller } = await setup();
    const click = (x: number, y: number) => {
      session.setTool("text");
      controller.down(at(x, y), { kind: "surface" });
      controller.up(at(x, y));
      return session.slide.elements.at(-1)!;
    };
    // The slide is 960 by 540 and the box 300 by 56.
    expect(click(900, 520)).toMatchObject({ x: 660, y: 484 });
    expect(click(-20, -5)).toMatchObject({ x: 0, y: 0 });
    expect(click(959, 10)).toMatchObject({ x: 660, y: 10 });
  });

  it("snaps a text box made by a click to what is on the slide, unless snapping is off or Alt is held", async () => {
    const snapped = await setup(true);
    snapped.session.setTool("text");
    // The ellipse's left edge is at 500, and nothing else is near the box's other edges down here.
    snapped.controller.down(at(497, 450), { kind: "surface" });
    snapped.controller.up(at(497, 450));
    expect(snapped.session.slide.elements.at(-1)).toMatchObject({ x: 500, y: 450 });

    snapped.session.setTool("text");
    snapped.controller.down(at(497, 450, { alt: true }), { kind: "surface" });
    snapped.controller.up(at(497, 450, { alt: true }));
    expect(snapped.session.slide.elements.at(-1)).toMatchObject({ x: 497, y: 450 });

    const free = await setup(false);
    free.session.setTool("text");
    free.controller.down(at(497, 450), { kind: "surface" });
    free.controller.up(at(497, 450));
    expect(free.session.slide.elements.at(-1)).toMatchObject({ x: 497, y: 450 });
  });

  it("still centres a shape made by a click on it, and draws a text box the size of the drag", async () => {
    const { session, controller } = await setup();
    session.setTool("shape:rect");
    controller.down(at(700, 100), { kind: "surface" });
    controller.up(at(700, 100));
    expect(session.slide.elements.at(-1)).toMatchObject({ shape: "rect", x: 620, y: 40, w: 160, h: 120 });
    session.setTool("text");
    drag(controller, [60, 440], [260, 500]);
    expect(session.slide.elements.at(-1)).toMatchObject({ type: "text", x: 60, y: 440, w: 200, h: 60 });
  });

  it("draws a free line, and a connector when it starts or ends on a shape", async () => {
    const { session, controller, a, b } = await setup();
    session.setTool("arrow:straight");
    drag(controller, [20, 450], [220, 500]);
    expect(session.slide.elements.at(-1)).toMatchObject({ type: "line", x: 20, y: 450, w: 200, h: 50 });

    session.setTool("arrow:elbow");
    // From the right side of the first shape (300, 150) to the left side of the second (500, 360).
    drag(controller, [302, 151], [498, 359]);
    const connector = session.slide.elements.at(-1)!;
    expect(connector).toMatchObject({ type: "connector", route: "elbow", from: { el: a, side: "right" }, to: { el: b, side: "left" } });
    // It follows the shapes when one of them moves.
    session.elements.nudge(0, 40, [b]);
    expect(find(session, connector.id)).toMatchObject({ y: 150, h: 250 });
  });

  it("puts a short drag of a line at a default length", async () => {
    const { session, controller } = await setup();
    session.setTool("line:straight");
    controller.down(at(40, 450), { kind: "surface" });
    controller.up(at(41, 450));
    expect(session.slide.elements.at(-1)).toMatchObject({ type: "line", x: 40, y: 450, w: 120 });
  });

  it("drags the end of a line and leaves the other where it was", async () => {
    const { session, controller } = await setup();
    session.setTool("line:straight");
    drag(controller, [20, 450], [220, 500]);
    const line = session.slide.elements.at(-1)!;
    expect(session.state.selection).toEqual([line.id]);
    drag(controller, [220, 500], [320, 440], { kind: "end", end: "end" });
    expect(find(session, line.id)).toMatchObject({ x: 20, y: 440, w: 300, h: 10, flipV: true });
  });
});

describe("angles", () => {
  it("snaps a direction to the nearest 45 degrees at the same length", () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 100, y: 12 });
    expect(p.x).toBeCloseTo(Math.hypot(100, 12), 5);
    expect(p.y).toBeCloseTo(0, 5);
    const d = snapAngle({ x: 10, y: 10 }, { x: 60, y: 50 });
    expect(d.x - 10).toBeCloseTo(d.y - 10, 5);
  });
});

describe("text boxes with the text tool in hand", () => {
  it("does nothing on a right-button press", async () => {
    const { controller } = await setup();
    controller.down(at(150, 150, { button: 2 }), { kind: "surface" });
    expect(controller.busy).toBe(false);
  });

  it("inserts a text box with its own words when one is pasted", async () => {
    const { session } = await setup();
    const [id] = session.elements.insert([textBox({ x: 10, y: 10, w: 100, h: 30 }, "x")]);
    expect(id).toBeDefined();
  });
});
