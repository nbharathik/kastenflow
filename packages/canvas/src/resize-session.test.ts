import { describe, expect, it } from "vitest";

import type { Item } from "./items.ts";
import { ResizeSession } from "./session.ts";
import type { Frame } from "./snap.ts";
import type { Handle } from "./transform.ts";

const frame: Frame = { width: 960, height: 540 };
// Lines: a at x 100 / 150 / 200, y 100 / 125 / 150; b at x 400 / 450 / 500, y 300 / 350 / 400;
// c at x 700 / 750 / 800, y 450 / 475 / 500; the slide at x 0 / 480 / 960, y 0 / 270 / 540.
const a: Item = { id: "a", x: 100, y: 100, w: 100, h: 50 };
const b: Item = { id: "b", x: 400, y: 300, w: 100, h: 100 };
const c: Item = { id: "c", x: 700, y: 450, w: 100, h: 50 };
const all = [a, b, c];

type Point = { x: number; y: number };

/** A session resizing b, which begins with the pointer on `grabbed`. */
const resizeB = (handle: Handle, grabbed?: Point) => ResizeSession.start({ items: [b], handle, all, frame, grabbed });

describe("ResizeSession keeping the proportions by default (a picture)", () => {
  // `a` is 100 x 50, so the ratio is 2.
  const picture = (shift: boolean) => ResizeSession.start({ items: [a], handle: "se", all, frame, grabbed: { x: 200, y: 150 }, keepByDefault: true }).update({ x: 300, y: 160 }, { shift, noSnap: true }).boxes.get("a");

  it("keeps the ratio with no key held", () => {
    expect(picture(false)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });

  it("stretches freely with Shift held", () => {
    expect(picture(true)).toEqual({ x: 100, y: 100, w: 200, h: 60 });
  });

  it("is the other way round for what does not keep its shape: Shift keeps it", () => {
    const free = ResizeSession.start({ items: [a], handle: "se", all, frame, grabbed: { x: 200, y: 150 } });
    expect(free.update({ x: 300, y: 160 }, { noSnap: true }).boxes.get("a")).toEqual({ x: 100, y: 100, w: 200, h: 60 });
    expect(free.update({ x: 300, y: 160 }, { shift: true, noSnap: true }).boxes.get("a")).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });
});

describe("ResizeSession on one upright item", () => {
  it("resizes by the pointer's travel from where it went down", () => {
    const p = resizeB("e", { x: 500, y: 350 }).update({ x: 537, y: 350 });
    expect(p.boxes).toEqual(new Map([["b", { x: 400, y: 300, w: 137, h: 100 }]]));
    expect(p.guides).toEqual([]);
  });

  it("takes the handle itself as where it went down if not told", () => {
    const told = resizeB("e", { x: 500, y: 350 }).update({ x: 537, y: 350 });
    expect(resizeB("e").update({ x: 537, y: 350 }).boxes).toEqual(told.boxes);
    // A drag that began a little off the handle does not jump.
    expect(resizeB("e", { x: 503, y: 350 }).update({ x: 503, y: 350 }).boxes.get("b")).toEqual({ x: 400, y: 300, w: 100, h: 100 });
  });

  it("puts the default grab on the right spot for every handle", () => {
    const at: [Handle, Point][] = [
      ["nw", { x: 400, y: 300 }],
      ["n", { x: 450, y: 300 }],
      ["ne", { x: 500, y: 300 }],
      ["e", { x: 500, y: 350 }],
      ["se", { x: 500, y: 400 }],
      ["s", { x: 450, y: 400 }],
      ["sw", { x: 400, y: 400 }],
      ["w", { x: 400, y: 350 }],
    ];
    for (const [handle, point] of at) {
      expect(resizeB(handle).update(point).boxes.get("b")).toEqual({ x: 400, y: 300, w: 100, h: 100 });
    }
  });

  it("grows a west drag to the left", () => {
    const p = resizeB("w", { x: 400, y: 350 }).update({ x: 370, y: 350 });
    expect(p.boxes.get("b")).toEqual({ x: 370, y: 300, w: 130, h: 100 });
  });

  it("snaps the dragged edge onto a neighbour's and reports the guide", () => {
    // 197 across puts b's right edge at 697, 3 short of c's left edge.
    const p = resizeB("e", { x: 500, y: 350 }).update({ x: 697, y: 350 });
    expect(p.boxes.get("b")).toEqual({ x: 400, y: 300, w: 300, h: 100 });
    expect(p.guides).toEqual([{ axis: "x", at: 700, from: 300, to: 500, kind: "edge" }]);
  });

  it("takes its reach from the option", () => {
    // 3 short of c's left edge, a reach of 2 is not enough.
    const s = ResizeSession.start({ items: [b], handle: "e", all, frame, grabbed: { x: 500, y: 350 }, snapThreshold: 2 });
    const p = s.update({ x: 697, y: 350 });
    expect(p.boxes.get("b")).toEqual({ x: 400, y: 300, w: 297, h: 100 });
    expect(p.guides).toEqual([]);
  });

  it("does not snap with noSnap, and shows no guides", () => {
    const p = resizeB("e", { x: 500, y: 350 }).update({ x: 697, y: 350 }, { noSnap: true });
    expect(p.boxes.get("b")).toEqual({ x: 400, y: 300, w: 297, h: 100 });
    expect(p.guides).toEqual([]);
  });

  it("keeps the ratio with Shift", () => {
    const s = resizeB("se", { x: 500, y: 400 });
    // 40 across and 10 down: the wider stretch, 1.4, sets both.
    expect(s.update({ x: 540, y: 410 }, { shift: true }).boxes.get("b")).toEqual({ x: 400, y: 300, w: 140, h: 140 });
    expect(s.update({ x: 540, y: 410 }, {}).boxes.get("b")).toEqual({ x: 400, y: 300, w: 140, h: 110 });
  });

  it("resizes from the centre with Alt, which leaves snapping on", () => {
    const s = resizeB("e", { x: 500, y: 350 });
    expect(s.update({ x: 540, y: 350 }, { alt: true }).boxes.get("b")).toEqual({ x: 360, y: 300, w: 180, h: 100 });
    // 197 out puts the right edge at 697, 3 short of c's left edge; the left edge goes 3 further out as well.
    const p = s.update({ x: 697, y: 350 }, { alt: true });
    expect(p.boxes.get("b")).toEqual({ x: 200, y: 300, w: 500, h: 100 });
    expect(p.guides).toEqual([{ axis: "x", at: 700, from: 300, to: 500, kind: "edge" }]);
  });

  it("mirrors the item when dragged past the opposite edge", () => {
    const p = resizeB("e", { x: 500, y: 350 }).update({ x: 350, y: 350 });
    expect(p.boxes.get("b")).toEqual({ x: 350, y: 300, w: 50, h: 100, flipH: true });
    const both = resizeB("se", { x: 500, y: 400 }).update({ x: 350, y: 250 });
    expect(both.boxes.get("b")).toEqual({ x: 350, y: 250, w: 50, h: 50, flipH: true, flipV: true });
  });

  it("snaps the edge that a mirrored box is really dragging", () => {
    // The east handle, dragged to 203, leaves the box spanning 203..400: its left edge is following the pointer,
    // 3 short of a's right edge at 200. Snapping the right edge instead (at 400, its fixed edge) would find nothing.
    const p = resizeB("e", { x: 500, y: 350 }).update({ x: 203, y: 350 });
    expect(p.boxes.get("b")).toEqual({ x: 200, y: 300, w: 200, h: 100, flipH: true });
    expect(p.guides).toEqual([{ axis: "x", at: 200, from: 100, to: 400, kind: "edge" }]);
  });

  it("gives no rotation key to an item without one, and keeps one it has", () => {
    expect("rotation" in (resizeB("e").update({ x: 520, y: 350 }).boxes.get("b") ?? {})).toBe(false);
    const upright: Item = { ...b, rotation: 0 };
    const p = ResizeSession.start({ items: [upright], handle: "e", all: [upright], frame }).update({ x: 520, y: 350 });
    expect(p.boxes.get("b")?.rotation).toBe(0);
  });

  describe("with the ratio kept", () => {
    it("shows a guide for each edge when both land on a line", () => {
      // Dragged to 701 across and 601 down, b is 301 square. c's left edge (700) and this strip's top (600) are each
      // 1 away, and keeping the square lets the box land on both.
      const strip: Item = { id: "strip", x: 0, y: 600, w: 50, h: 20 };
      const s = ResizeSession.start({ items: [b], handle: "se", all: [b, c, strip], frame, grabbed: { x: 500, y: 400 } });
      const p = s.update({ x: 701, y: 601 }, { shift: true });
      expect(p.boxes.get("b")).toEqual({ x: 400, y: 300, w: 300, h: 300 });
      expect(p.guides).toEqual([
        { axis: "x", at: 700, from: 300, to: 600, kind: "edge" },
        { axis: "y", at: 600, from: 0, to: 700, kind: "edge" },
      ]);
    });

    it("shows a guide only for the edge that landed, when the other is left off its line", () => {
      // The right edge lands on c's left edge, 3 away. The bottom edge follows to keep the square, and lands on nothing.
      const p = resizeB("se", { x: 500, y: 400 }).update({ x: 697, y: 500 }, { shift: true });
      expect(p.boxes.get("b")).toEqual({ x: 400, y: 300, w: 300, h: 300 });
      expect(p.guides).toEqual([{ axis: "x", at: 700, from: 300, to: 600, kind: "edge" }]);
    });
  });
});

describe("ResizeSession on a turned item", () => {
  // Turned a quarter, the east handle points down the slide, at (200, 250).
  const r: Item = { id: "r", x: 100, y: 100, w: 200, h: 100, rotation: 90 };

  it("resizes along its own axis", () => {
    const s = ResizeSession.start({ items: [r], handle: "e", all: [r], frame, grabbed: { x: 200, y: 250 } });
    expect(s.update({ x: 200, y: 280 }).boxes.get("r")).toEqual({ x: 85, y: 115, w: 230, h: 100, rotation: 90 });
    expect(s.update({ x: 230, y: 250 }).boxes.get("r")).toEqual({ x: 100, y: 100, w: 200, h: 100, rotation: 90 });
  });

  it("takes no snap: its edges are not upright, so there is no line for it to land on", () => {
    // After this drag its box, before it is turned, ends at x = 315. A neighbour's edge at 318 would pull it in
    // if the un-turned box were snapped, though that is not where the box is seen.
    const near: Item = { id: "near", x: 318, y: 400, w: 50, h: 50 };
    const s = ResizeSession.start({ items: [r], handle: "e", all: [r, near], frame, grabbed: { x: 200, y: 250 } });
    const p = s.update({ x: 200, y: 280 });
    expect(p.boxes.get("r")).toEqual({ x: 85, y: 115, w: 230, h: 100, rotation: 90 });
    expect(p.guides).toEqual([]);
  });

  it("takes none at a half turn or a tilt either", () => {
    // b turned upside down has its east handle at the left, (400, 350). Dragged to 203 it grows to the left, and its
    // un-turned box still ends at x = 500, 3 short of a neighbour's edge at 503; another at 200 is by the visible edge.
    const upside: Item = { ...b, rotation: 180 };
    const flank: Item = { id: "flank", x: 503, y: 450, w: 20, h: 20 };
    const p = ResizeSession.start({ items: [upside], handle: "e", all: [upside, a, flank], frame, grabbed: { x: 400, y: 350 } }).update({ x: 203, y: 350 });
    expect(p.boxes.get("b")).toEqual({ x: 203, y: 300, w: 297, h: 100, rotation: 180 });
    expect(p.guides).toEqual([]);

    // Tilted 30 degrees, dragged 40 along its own width, the un-turned box ends near x = 537.3; a neighbour's edge is at 540.
    const tilted: Item = { ...b, rotation: 30 };
    const beyond: Item = { id: "beyond", x: 540, y: 600, w: 10, h: 10 };
    const cos = Math.sqrt(3) / 2;
    const handle = { x: 450 + 50 * cos, y: 350 + 25 };
    const q = ResizeSession.start({ items: [tilted], handle: "e", all: [tilted, beyond], frame }).update({ x: handle.x + 40 * cos, y: handle.y + 20 });
    expect(q.boxes.get("b")?.w).toBeCloseTo(140, 9);
    expect(q.guides).toEqual([]);
  });
});

describe("ResizeSession results", () => {
  const grabbed = { x: 500, y: 350 };

  it("says nothing changed if the pointer never moved, or came back", () => {
    const s = resizeB("e", grabbed);
    expect(s.end().changed).toBe(false);
    s.update({ x: 537, y: 350 });
    s.update(grabbed);
    const done = s.end();
    expect(done.changed).toBe(false);
    expect(done.boxes.get("b")).toEqual({ x: 400, y: 300, w: 100, h: 100 });
  });

  it("gives the last boxes from end, with or without a last position", () => {
    const s = resizeB("e", grabbed);
    s.update({ x: 537, y: 350 });
    expect(s.end()).toEqual({ boxes: new Map([["b", { x: 400, y: 300, w: 137, h: 100 }]]), changed: true });
    expect(resizeB("e", grabbed).end({ x: 537, y: 350 }).boxes.get("b")).toEqual({ x: 400, y: 300, w: 137, h: 100 });
  });

  it("counts a mirrored item as changed", () => {
    const s = resizeB("e", grabbed);
    s.update({ x: 300, y: 350 });
    expect(s.end().changed).toBe(true);
  });

  it("counts a mirrored item as changed even when it lands where it began", () => {
    // From the centre, dragging the east handle 100 left mirrors b about its own middle: the same box, flipped.
    const s = resizeB("e", grabbed);
    const p = s.update({ x: 400, y: 350 }, { alt: true });
    expect(p.boxes.get("b")).toEqual({ x: 400, y: 300, w: 100, h: 100, flipH: true });
    expect(s.end().changed).toBe(true);
  });

  it.each<[Handle, Point]>([
    ["e", { x: 510, y: 350 }],
    ["w", { x: 390, y: 350 }],
    ["s", { x: 450, y: 410 }],
    ["n", { x: 450, y: 290 }],
  ])("counts a drag of the %s handle as a change", (handle, to) => {
    const s = resizeB(handle);
    s.update(to);
    expect(s.end().changed).toBe(true);
  });

  it("counts items that only shift as changed: stretching two vertical rules moves one", () => {
    const first: Item = { id: "r1", x: 100, y: 100, w: 0, h: 100 };
    const second: Item = { id: "r2", x: 200, y: 100, w: 0, h: 100 };
    // Together they fill x 100..200, so the east handle is at (200, 150); 50 further stretches the gap by half.
    const s = ResizeSession.start({ items: [first, second], handle: "e", all: [first, second], frame });
    expect(s.update({ x: 250, y: 150 }).boxes.get("r2")).toEqual({ x: 250, y: 100, w: 0, h: 100 });
    expect(s.end().changed).toBe(true);
  });

  it("counts the same for horizontal rules stretched down", () => {
    const first: Item = { id: "r1", x: 100, y: 100, w: 100, h: 0 };
    const second: Item = { id: "r2", x: 100, y: 200, w: 100, h: 0 };
    const s = ResizeSession.start({ items: [first, second], handle: "s", all: [first, second], frame });
    expect(s.update({ x: 150, y: 250 }).boxes.get("r2")).toEqual({ x: 100, y: 250, w: 100, h: 0 });
    expect(s.end().changed).toBe(true);
  });

  it("leaves no floating-point dust on a snapped size", () => {
    // Dragged to 397.1, 3 short of the neighbour's edge at 400.1: the width is 390, not 390.00000000000006.
    const wide: Item = { id: "wide", x: 10.1, y: 100, w: 93.3, h: 50 };
    const neighbour: Item = { id: "n", x: 400.1, y: 300, w: 100, h: 100 };
    const s = ResizeSession.start({ items: [wide], handle: "e", all: [wide, neighbour], frame, grabbed: { x: 103.4, y: 125 } });
    expect(s.update({ x: 397.1, y: 125 }).boxes.get("wide")).toEqual({ x: 10.1, y: 100, w: 390, h: 50 });
  });

  it("leaves no dust on a rotation either", () => {
    const dusty: Item = { ...b, rotation: 29.999999999999993 };
    const s = ResizeSession.start({ items: [dusty], handle: "e", all: [dusty], frame });
    expect(s.update({ x: 500, y: 350 }).boxes.get("b")?.rotation).toBe(30);
  });

  it("gives a fresh preview each time", () => {
    const s = resizeB("e", grabbed);
    const first = s.update({ x: 537, y: 350 });
    s.update({ x: 560, y: 350 });
    expect(first.boxes.get("b")?.w).toBe(137);
  });

  it("does nothing with nothing to resize", () => {
    const s = ResizeSession.start({ items: [], handle: "e", all, frame, grabbed });
    expect(s.update({ x: 900, y: 900 })).toEqual({ boxes: new Map(), guides: [] });
    expect(s.end()).toEqual({ boxes: new Map(), changed: false });
  });
});
