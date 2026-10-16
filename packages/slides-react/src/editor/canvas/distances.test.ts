// @vitest-environment node

import { describe, expect, it } from "vitest";

import { gapsBetween } from "./distances.ts";

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("the gaps between the selection and another block", () => {
  it("is the space between the sides that face each other, drawn where the two overlap", () => {
    // 100 wide at the left, a block 50 to its right, overlapping from y 10 to 50.
    expect(gapsBetween(rect(0, 0, 100, 50), rect(150, 10, 50, 100))).toEqual([{ axis: "x", from: 100, to: 150, at: 30, size: 50 }]);
    expect(gapsBetween(rect(0, 0, 50, 100), rect(10, 130, 100, 50))).toEqual([{ axis: "y", from: 100, to: 130, at: 30, size: 30 }]);
  });

  it("is the same whichever of the two is the selection", () => {
    expect(gapsBetween(rect(150, 10, 50, 100), rect(0, 0, 100, 50))).toEqual([{ axis: "x", from: 100, to: 150, at: 30, size: 50 }]);
    expect(gapsBetween(rect(10, 130, 100, 50), rect(0, 0, 50, 100))).toEqual([{ axis: "y", from: 100, to: 130, at: 30, size: 30 }]);
  });

  it("has one gap each way for blocks corner to corner, along the middle of the selection", () => {
    expect(gapsBetween(rect(0, 0, 100, 50), rect(140, 90, 50, 50))).toEqual([
      { axis: "x", from: 100, to: 140, at: 25, size: 40 },
      { axis: "y", from: 50, to: 90, at: 50, size: 40 },
    ]);
  });

  it("is the distance to each side of the outer block for a block inside another", () => {
    const outer = rect(0, 0, 400, 300);
    const inner = rect(50, 40, 200, 100);
    const expected = [
      { axis: "x", from: 0, to: 50, at: 90, size: 50 },
      { axis: "x", from: 250, to: 400, at: 90, size: 150 },
      { axis: "y", from: 0, to: 40, at: 150, size: 40 },
      { axis: "y", from: 140, to: 300, at: 150, size: 160 },
    ];
    expect(gapsBetween(outer, inner)).toEqual(expected);
    expect(gapsBetween(inner, outer)).toEqual(expected);
  });

  it("leaves out a side that touches", () => {
    expect(gapsBetween(rect(0, 0, 400, 300), rect(0, 40, 200, 100)).map((g) => [g.axis, g.size])).toEqual([
      ["x", 200],
      ["y", 40],
      ["y", 160],
    ]);
  });

  it("has none for blocks that touch, or that overlap without one holding the other", () => {
    expect(gapsBetween(rect(0, 0, 100, 50), rect(100, 0, 50, 50))).toEqual([]);
    expect(gapsBetween(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toEqual([]);
    expect(gapsBetween(rect(0, 0, 100, 100), rect(0, 0, 100, 100))).toEqual([]);
  });

  it("works with fractions", () => {
    const [only] = gapsBetween(rect(0.25, 0, 10, 10), rect(20.5, 0, 10, 10));
    expect(only?.size).toBeCloseTo(10.25);
  });
});
