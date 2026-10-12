import { describe, expect, it } from "vitest";

import { scrollFor, wheelFactor } from "./stage-zoom.ts";

describe("what a wheel or a pinch zooms by", () => {
  it("zooms in for a wheel turned away and out for one turned back, by more for a notch than for a pinch step", () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    expect(wheelFactor(-4, 0)).toBeGreaterThan(1);
    expect(wheelFactor(-4, 0)).toBeLessThan(wheelFactor(-100, 0));
  });

  it("is one step of at most about a fifth, so a flick cannot leap across the range", () => {
    expect(wheelFactor(-100000, 0)).toBeLessThan(1.3);
    expect(wheelFactor(100000, 0)).toBeGreaterThan(0.7);
  });

  it("reads lines and pages as pixels", () => {
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48, 0), 5);
    expect(wheelFactor(NaN, 0)).toBe(1);
  });
});

describe("keeping the place under the pointer", () => {
  it("needs no scroll when the page lands where the point wants it", () => {
    // The page is at (50, 40) and the point at (250, 140) is slide point (100, 50) at zoom 2: the page's top left should be (250 - 200, 140 - 100).
    expect(scrollFor({ left: 50, top: 40 }, { x: 250, y: 140 }, { x: 100, y: 50 }, 2)).toEqual({ dx: 0, dy: 0 });
  });

  it("scrolls by how far the new size has moved the point", () => {
    // Zoomed to 2 with the page's left edge at 0: the point that was at x = 300 (slide 150 at zoom 2... now) has gone to 0 + 150 * 2 = 300.
    // Held at 200, so the stage must scroll right by 100.
    expect(scrollFor({ left: 0, top: 0 }, { x: 200, y: 100 }, { x: 150, y: 80 }, 2)).toEqual({ dx: 100, dy: 60 });
    // And left when it has gone the other way.
    expect(scrollFor({ left: 0, top: 0 }, { x: 400, y: 100 }, { x: 150, y: 80 }, 2).dx).toBe(-100);
  });
});
