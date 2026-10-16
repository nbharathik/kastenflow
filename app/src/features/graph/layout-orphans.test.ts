// Notes with no links ("orphans") are packed into a tidy island beside the
// linked graph instead of floating around its edge, and they stay where they
// were put: a note added later takes a free place, and the others do not move.

import { describe, expect, it } from "vitest";

import { Layout, settle } from "./layout";

const pairs = (...edges: [number, number][]) => Uint32Array.from(edges.flat());

/** A ring of `n` linked nodes (0..n-1), then `orphans` nodes with no links. */
function ringAndOrphans(n: number, orphans: number) {
  const edges = pairs(...Array.from({ length: n }, (_, i): [number, number] => [i, (i + 1) % n]));
  return { count: n + orphans, edges, linked: n };
}

const at = (p: ArrayLike<number>, i: number): [number, number] => [p[2 * i]!, p[2 * i + 1]!];
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("orphans in the force layout", () => {
  it("are packed into one compact island, clear of the linked graph and of each other", () => {
    const { count, edges, linked } = ringAndOrphans(40, 150);
    const p = settle(count, edges, { seed: 3 });
    expect(p.every(Number.isFinite)).toBe(true);
    // The linked graph's own extent.
    let reach = 0;
    for (let i = 0; i < linked; i++) reach = Math.max(reach, Math.hypot(...at(p, i)));
    const orphans = Array.from({ length: count - linked }, (_, k) => at(p, linked + k));
    // None sits among the linked nodes.
    for (const o of orphans) expect(Math.hypot(...o)).toBeGreaterThan(reach);
    // None sits on another.
    let closest = Infinity;
    for (let a = 0; a < orphans.length; a++) for (let b = a + 1; b < orphans.length; b++) closest = Math.min(closest, dist(orphans[a]!, orphans[b]!));
    expect(closest).toBeGreaterThan(8);
    // They form one island: every orphan is within a short walk of the island's middle.
    const middle: [number, number] = [orphans.reduce((s, o) => s + o[0], 0) / orphans.length, orphans.reduce((s, o) => s + o[1], 0) / orphans.length];
    const span = Math.max(...orphans.map((o) => dist(o, middle)));
    expect(span).toBeLessThan(16 * Math.sqrt(orphans.length));
    // And the island is close: its far edge is not far beyond the linked graph's.
    expect(Math.max(...orphans.map((o) => Math.hypot(...o)))).toBeLessThan(reach + 40 + 2 * 16 * Math.sqrt(orphans.length));
  });

  it("do not push the linked graph around, so it settles as it would without them", () => {
    const { count, edges, linked } = ringAndOrphans(24, 0);
    const alone = settle(count, edges, { seed: 5 });
    const crowded = settle(count + 300, edges, { seed: 5 });
    for (let i = 0; i < linked; i++) {
      expect(at(crowded, i)[0]).toBeCloseTo(at(alone, i)[0], 3);
      expect(at(crowded, i)[1]).toBeCloseTo(at(alone, i)[1], 3);
    }
  });

  it("are laid in the same places every time for the same graph and seed", () => {
    const { count, edges } = ringAndOrphans(12, 40);
    expect(Array.from(settle(count, edges, { seed: 9 }))).toEqual(Array.from(settle(count, edges, { seed: 9 })));
  });

  it("are all there is when nothing is linked: a spiral about the middle", () => {
    const p = settle(60, new Uint32Array(0), { seed: 1 });
    expect(p.every(Number.isFinite)).toBe(true);
    let mx = 0;
    let my = 0;
    for (let i = 0; i < 60; i++) [mx, my] = [mx + p[2 * i]!, my + p[2 * i + 1]!];
    // Round the middle, not off to a side.
    expect(Math.hypot(mx / 60, my / 60)).toBeLessThan(30);
    let closest = Infinity;
    for (let a = 0; a < 60; a++) for (let b = a + 1; b < 60; b++) closest = Math.min(closest, dist(at(p, a), at(p, b)));
    expect(closest).toBeGreaterThan(8);
  });
});

describe("orphans keep their places", () => {
  it("when a note is added: the ones laid out before do not move, and the new one takes a free place", () => {
    const first = ringAndOrphans(20, 60);
    const before = settle(first.count, first.edges, { seed: 4 });
    // One more orphan and one more linked node join; everything laid out before is given as where it was.
    const more = ringAndOrphans(20, 60);
    const count = more.count + 2;
    const edges = Uint32Array.from([...more.edges, 0, more.count + 1]);
    const start = new Float64Array(count * 2).fill(Number.NaN);
    for (let i = 0; i < more.count * 2; i++) start[i] = before[i]!;
    const after = new Layout(count, edges, { seed: 4, start, heat: 0.35, ticks: 300 });
    while (!after.step());
    const now = after.positions();
    for (let i = more.linked; i < more.count; i++) {
      expect(at(now, i), `orphan ${i}`).toEqual(at(before, i));
    }
    // The node after them is a new orphan (nothing links it; the last one is the linked newcomer): it found a place of its own.
    const added = more.count;
    for (let i = more.linked; i < more.count; i++) expect(dist(at(now, added), at(now, i))).toBeGreaterThan(8);
  });

  it("when a note is taken away: the others stay", () => {
    const { count, edges, linked } = ringAndOrphans(16, 30);
    const before = settle(count, edges, { seed: 2 });
    // The orphan at index `linked + 5` is gone; the nodes after it shift down one index.
    const gone = linked + 5;
    const kept = Float64Array.from({ length: (count - 1) * 2 }, (_, k) => {
      const node = Math.floor(k / 2);
      return before[2 * (node >= gone ? node + 1 : node) + (k % 2)]!;
    });
    const after = new Layout(count - 1, edges, { seed: 2, start: kept, heat: 0.35 });
    while (!after.step());
    const now = after.positions();
    for (let i = linked; i < count - 1; i++) expect(at(now, i)).toEqual(at(before, i >= gone ? i + 1 : i));
  });

  it("when the graph is opened again exactly as it was left: nothing moves", () => {
    const { count, edges, linked } = ringAndOrphans(10, 25);
    const before = settle(count, edges, { seed: 6 });
    const cold = new Layout(count, edges, { seed: 6, start: Float64Array.from(before), heat: 0 });
    expect(cold.settled).toBe(true);
    const now = cold.positions();
    for (let i = linked; i < count; i++) expect(at(now, i)).toEqual(at(before, i));
  });
});
