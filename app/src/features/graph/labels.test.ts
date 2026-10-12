import { describe, expect, it } from "vitest";

import { placeLabels, type Candidate } from "./labels";

const measure = (text: string) => text.length * 6;
const at = (index: number, x: number, y: number, over: Partial<Candidate> = {}): Candidate => ({ index, x, y, r: 4, text: `node ${index}`, priority: 1, ...over });
const indices = (c: readonly Candidate[], max?: number) => placeLabels(c, 800, 600, measure, max).map((p) => p.index);

describe("placing node names", () => {
  it("names every node that has room", () => {
    expect(indices([at(0, 100, 100), at(1, 300, 100), at(2, 500, 300)]).sort()).toEqual([0, 1, 2]);
  });

  it("puts a name below its node, centred", () => {
    const [name] = placeLabels([at(0, 100, 100, { text: "abcdefghij" })], 800, 600, measure);
    expect(name!.x).toBe(100 - 30);
    expect(name!.y).toBeGreaterThan(100 + 4);
  });

  it("leaves out a name that would land on one already placed, the more linked winning", () => {
    const near = [at(0, 100, 100, { priority: 2 }), at(1, 110, 104, { priority: 9 }), at(2, 400, 100, { priority: 5 })];
    expect(indices(near)).toEqual([1, 2]);
  });

  it("always draws a forced name, over others", () => {
    const placed = indices([at(0, 100, 100, { priority: 9 }), at(1, 105, 102, { priority: 1, force: true })]);
    // The forced one goes first and the other, now covered, is left out.
    expect(placed).toEqual([1]);
    const both = indices([at(0, 100, 100, { force: true }), at(1, 105, 102, { force: true })]);
    expect(both.sort()).toEqual([0, 1]);
  });

  it("slides a name that would be cut by the canvas's edge inside it", () => {
    const [right] = placeLabels([at(0, 790, 100, { text: "abcdefghij" })], 800, 600, measure);
    expect(right!.x + 60).toBeLessThanOrEqual(796);
    const [left] = placeLabels([at(0, 5, 100, { text: "abcdefghij" })], 800, 600, measure);
    expect(left!.x).toBe(4);
    // A name wider than the canvas stays centred, as it cannot fit anyway.
    const [wide] = placeLabels([at(0, 50, 100, { text: "x".repeat(200) })], 100, 600, measure);
    expect(wide!.x).toBe(50 - 600);
  });

  it("leaves out names off the canvas and stops at the most it is asked for", () => {
    expect(indices([at(0, -400, 100), at(1, 100, 900), at(2, 100, 100)])).toEqual([2]);
    const many = Array.from({ length: 30 }, (_, i) => at(i, 20 + (i % 10) * 75, 30 + Math.floor(i / 10) * 100));
    expect(indices(many, 7)).toHaveLength(7);
    // A forced name is not counted against the limit.
    const forced = [...many, at(99, 400, 580, { force: true })];
    expect(indices(forced, 7)).toContain(99);
  });
});
