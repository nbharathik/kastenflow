// The layouts of the grid and of a slide before and after: plain numbers, kept within the
// size a picture may have.

import { describe, expect, it } from "vitest";

import { diffLayout, gridLayout, markBox, thumbBox } from "./slide-compose";

describe("the grid of slides", () => {
  it("is as wide as it needs for the slides and within the most pixels allowed", () => {
    for (const count of [1, 2, 8, 30, 100]) {
      const layout = gridLayout(count, 960, 540, 4000);
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(count);
      expect(layout.width).toBeLessThanOrEqual(4000);
      expect(layout.thumb.h).toBe(Math.round((layout.thumb.w * 540) / 960));
    }
    expect(gridLayout(1, 960, 540, 4000).columns).toBe(1);
    expect(gridLayout(8, 960, 540, 4000)).toMatchObject({ columns: 4, rows: 2, thumb: { w: 320, h: 180 } });
  });

  it("makes the thumbnails smaller when the pictures must be narrow", () => {
    const layout = gridLayout(8, 960, 540, 800);
    expect(layout.width).toBeLessThanOrEqual(800);
    expect(layout.thumb.w).toBeLessThan(320);
  });

  it("puts each thumbnail in its own place, row by row, without overlap", () => {
    const layout = gridLayout(6, 960, 540, 4000);
    const boxes = Array.from({ length: 6 }, (_, i) => thumbBox(layout, i));
    expect(boxes[0]).toMatchObject({ x: 12, y: 12 });
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.w - 1);
    expect(boxes[layout.columns]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.h);
    for (const box of boxes) {
      expect(box.x + box.w).toBeLessThanOrEqual(layout.width);
      expect(box.y + box.h).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe("a slide before and after", () => {
  it("is two slides side by side under a heading", () => {
    const layout = diffLayout(960, 540, 1, 4000);
    expect(layout.scale).toBe(1);
    expect(layout.before.w).toBe(960);
    expect(layout.after.x).toBeGreaterThan(layout.before.x + layout.before.w);
    expect(layout.width).toBeGreaterThan(2 * 960);
    expect(layout.height).toBeGreaterThan(540);
  });

  it("is drawn smaller when two slides at that scale would be too wide", () => {
    const layout = diffLayout(960, 540, 4, 4000);
    expect(layout.width).toBeLessThanOrEqual(4000);
    expect(layout.scale).toBeLessThan(4);
  });

  it("outlines a mark a little outside its box, on the picture it belongs to", () => {
    const box = { x: 100, y: 50, w: 480, h: 270 };
    // The picture is half the size of the slide's units.
    expect(markBox([100, 40, 200, 20], box, 960)).toEqual({ x: 100 + 50 - 2, y: 50 + 20 - 2, w: 100 + 4, h: 10 + 4 });
    expect(markBox([], box, 960)).toEqual({ x: 98, y: 48, w: 4, h: 4 });
  });
});
