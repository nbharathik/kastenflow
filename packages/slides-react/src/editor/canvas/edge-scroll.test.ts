import { describe, expect, it } from "vitest";

import { EDGE, MOST, speedAt } from "./edge-scroll.ts";

describe("how fast a drag at the edge of the window carries the stage", () => {
  it("does not scroll in the middle", () => {
    expect(speedAt(300, 0, 600)).toBe(0);
    expect(speedAt(EDGE, 0, 600)).toBe(0);
  });

  it("scrolls towards the nearer edge, faster the nearer the pointer is to it", () => {
    expect(speedAt(EDGE - 10, 0, 600)).toBeLessThan(0);
    expect(speedAt(600 - EDGE + 10, 0, 600)).toBeGreaterThan(0);
    expect(Math.abs(speedAt(4, 0, 600))).toBeGreaterThan(Math.abs(speedAt(EDGE - 8, 0, 600)));
  });

  it("is at most a set number of pixels a frame, however far past the edge the pointer is", () => {
    expect(speedAt(-500, 0, 600)).toBe(-MOST);
    expect(speedAt(9000, 0, 600)).toBe(MOST);
    expect(speedAt(0, 0, 600)).toBe(-MOST);
  });

  it("reads the edges where the stage is, not the window", () => {
    expect(speedAt(120, 100, 700)).toBeLessThan(0);
    expect(speedAt(300, 100, 700)).toBe(0);
  });
});
