import { describe, expect, it } from "vitest";

import { Layout, settle } from "./layout";
import { QuadTree } from "./quadtree";

const pairs = (...edges: [number, number][]) => Uint32Array.from(edges.flat());
const distance = (p: Float32Array, a: number, b: number) => Math.hypot(p[2 * a]! - p[2 * b]!, p[2 * a + 1]! - p[2 * b + 1]!);

/** A chain 0-1-2-…, and a ring of the same length closing it. */
const chain = (n: number) => pairs(...Array.from({ length: n - 1 }, (_, i): [number, number] => [i, i + 1]));

describe("the force layout", () => {
  it("settles on its own, within its budget, to the same picture every time", () => {
    const edges = pairs([0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [5, 6]);
    const first = settle(7, edges, { seed: 7 });
    const again = settle(7, edges, { seed: 7 });
    expect(Array.from(again)).toEqual(Array.from(first));
    expect(first.every(Number.isFinite)).toBe(true);

    const layout = new Layout(7, edges, { ticks: 120 });
    let steps = 0;
    while (!layout.step()) steps++;
    // One more step settled it: at most the budget.
    expect(steps + 1).toBeLessThanOrEqual(120);
    expect(layout.settled).toBe(true);
    expect(layout.step()).toBe(true);
    expect(layout.steps).toBeLessThanOrEqual(120);
  });

  it("stops at its step budget however hot it still is", () => {
    const layout = new Layout(20, chain(20), { ticks: 10 });
    while (!layout.step());
    expect(layout.steps).toBe(10);
  });

  it("pulls linked nodes near the rest length and keeps strangers apart", () => {
    const p = settle(6, pairs([0, 1], [1, 2], [3, 4], [4, 5]), { seed: 3 });
    expect(distance(p, 0, 1)).toBeGreaterThan(8);
    expect(distance(p, 0, 1)).toBeLessThan(80);
    // The ends of a chain of three are farther apart than its neighbours.
    expect(distance(p, 0, 2)).toBeGreaterThan(distance(p, 0, 1));
    // No two nodes sit on top of each other, the islands' included.
    let closest = Infinity;
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) closest = Math.min(closest, distance(p, a, b));
    expect(closest).toBeGreaterThan(5);
  });

  it("keeps the linked graph centred and the nodes without links near it (their island is in layout-orphans.test.ts)", () => {
    const edges = pairs([0, 1], [1, 2], [2, 3]);
    const p = settle(12, edges, { seed: 5 });
    let [mx, my] = [0, 0];
    for (let i = 0; i < 4; i++) [mx, my] = [mx + p[2 * i]!, my + p[2 * i + 1]!];
    expect(Math.abs(mx / 4)).toBeLessThan(1);
    expect(Math.abs(my / 4)).toBeLessThan(1);
    // The loners did not fly away.
    for (let i = 4; i < 12; i++) expect(Math.hypot(p[2 * i]!, p[2 * i + 1]!)).toBeLessThan(400);
  });

  it("starts from the places it was given, and puts a new node beside its neighbours", () => {
    const start = Float64Array.from([100, 0, 130, 0, Number.NaN, Number.NaN]);
    const cold = new Layout(3, pairs([0, 1], [1, 2]), { start, heat: 0 });
    expect(cold.settled).toBe(true);
    // Nothing moves a layout with no heat; node 2 starts by node 1.
    expect(cold.x[0]).toBe(100);
    expect(cold.x[1]).toBe(130);
    expect(Math.hypot(cold.x[2]! - 130, cold.y[2]!)).toBeLessThan(30);
    // Warm, it settles near where it started rather than from scratch.
    const warm = settle(3, pairs([0, 1], [1, 2]), { start, heat: 0.2, ticks: 200 });
    expect(distance(warm, 0, 1)).toBeLessThan(80);
  });

  it("copes with a thousand nodes at one place, and an empty graph", () => {
    const start = new Float64Array(2000);
    const p = settle(1000, new Uint32Array(0), { start, ticks: 50 });
    expect(p.every(Number.isFinite)).toBe(true);
    expect(settle(0, new Uint32Array(0)).length).toBe(0);
    expect(settle(1, new Uint32Array(0)).length).toBe(2);
  });

  it("lays out two thousand linked nodes in good time", () => {
    const edges = pairs(...Array.from({ length: 3000 }, (_, i): [number, number] => [(i * 7919) % 2000, (i * 104729 + 13) % 2000]));
    const began = performance.now();
    const p = settle(2000, edges, { seed: 1 });
    const took = performance.now() - began;
    expect(p.every(Number.isFinite)).toBe(true);
    expect(took).toBeLessThan(20_000);
  });
});

describe("the quadtree", () => {
  const random = (n: number, seed: number) => {
    let s = seed;
    return Float64Array.from({ length: n }, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 1000 - 500);
  };

  it("finds the nearest body to a point, as a scan does", () => {
    const [x, y] = [random(500, 1), random(500, 2)];
    const tree = new QuadTree(500);
    tree.build(x, y, 500);
    const probes = random(60, 3);
    for (let i = 0; i + 1 < probes.length; i += 2) {
      const [px, py] = [probes[i]!, probes[i + 1]!];
      let best = -1;
      let bestD = 40 * 40;
      for (let b = 0; b < 500; b++) {
        const d = (x[b]! - px) ** 2 + (y[b]! - py) ** 2;
        if (d <= bestD) [best, bestD] = [b, d];
      }
      expect(tree.nearest(px, py, 40)).toBe(best);
    }
    expect(tree.nearest(5000, 5000, 40)).toBe(-1);
  });

  it("stands a far cell in for its bodies, and with theta 0 gives every other body", () => {
    const [x, y] = [random(800, 4), random(800, 5)];
    const tree = new QuadTree(800);
    tree.build(x, y, 800);
    let mass = 0;
    let visits = 0;
    tree.forEachNear(17, x[17]!, y[17]!, 0, Infinity, (m) => {
      mass += m;
      visits++;
    });
    expect(mass).toBe(799);
    expect(visits).toBe(799);
    let far = 0;
    let farVisits = 0;
    // Under 0.707 no cell holding the body itself can pass for far away.
    tree.forEachNear(17, x[17]!, y[17]!, 0.7, Infinity, (m) => {
      far += m;
      farVisits++;
    });
    expect(far).toBe(799);
    expect(farVisits).toBeLessThan(500);
  });

  it("holds bodies at one place in one leaf", () => {
    const x = new Float64Array(5).fill(3);
    const y = new Float64Array(5).fill(4);
    const tree = new QuadTree(5);
    tree.build(x, y, 5);
    let mass = 0;
    tree.forEachNear(0, 3, 4, 0.9, Infinity, (m) => (mass += m));
    expect(mass).toBeGreaterThan(0);
    expect(tree.nearest(3, 4, 1)).toBeGreaterThanOrEqual(0);
  });
});
