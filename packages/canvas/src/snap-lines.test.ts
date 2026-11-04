import { describe, expect, it } from "vitest";

import type { Rect } from "./geometry.ts";
import { snapMove, snapResize } from "./snap.ts";
import type { Frame } from "./snap.ts";

const box = (x: number, y: number, w = 50, h = 50): Rect => ({ x, y, w, h });

describe("snapping to the guides a person drew", () => {
  const frame: Frame = { width: 960, height: 540, lines: { x: [200], y: [120] } };

  it("lands a box edge on a vertical guide and draws it the slide's whole height", () => {
    const r = snapMove(box(203, 300), [], frame);
    expect(r.dx).toBe(-3);
    expect(r.guides).toContainEqual({ axis: "x", at: 200, from: 0, to: 540, kind: "guide" });
  });

  it("lands on a horizontal guide too", () => {
    const r = snapMove(box(600, 123), [], frame);
    expect(r.dy).toBe(-3);
    expect(r.guides).toContainEqual({ axis: "y", at: 120, from: 0, to: 960, kind: "guide" });
  });

  it("leaves a box alone that is farther than the threshold", () => {
    expect(snapMove(box(260, 300), [], frame)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("is switched off with the rest of snapping", () => {
    expect(snapMove(box(203, 300), [], frame, { enabled: false })).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("pulls the dragged edge of a box being resized onto a guide", () => {
    const r = snapResize(box(100, 100, 98, 50), "e", [], frame);
    expect(r.dx).toBe(2);
  });
});

describe("snapping to a grid", () => {
  const frame: Frame = { width: 960, height: 540, grid: 48 };

  it("pulls an edge onto the nearest grid line within the threshold, without a guide to draw", () => {
    const r = snapMove(box(98, 300), [], frame);
    expect(r.dx).toBe(-2);
    expect(r.guides).toEqual([]);
  });

  it("does nothing between the lines", () => {
    expect(snapMove(box(70, 300, 50, 50), [], { ...frame, grid: 200 })).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("is off without a size", () => {
    expect(snapMove(box(98, 301), [], { width: 960, height: 540, grid: 0 }).dx).toBe(0);
  });
});
