import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readPalette } from "./colours";
import { drawGraph, screenRadius, shorten, type DrawState, type Tools } from "./draw";
import { SHOW_ALL, modelOf } from "./graph-model";

class FakePath {
  segments = 0;
  moveTo() {
    this.segments++;
  }
  lineTo() {
    this.segments++;
  }
  arc() {
    this.segments++;
  }
}

/** A context that counts what it is asked to draw. */
function counting() {
  const calls = new Map<string, number>();
  const texts: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, key: string) => (...args: unknown[]) => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        if (key === "fillText") texts.push(String(args[0]));
      },
      set: () => true,
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts };
}

const tools: Tools = { path: () => new FakePath() as unknown as Path2D, measure: (text) => text.length * 6 };

/** A graph of n nodes and about 4.5 links each, like the 10,000-note vault. */
function big(n: number) {
  let seed = 7;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}.md`, path: `n${i}.md`, title: `Note number ${i}`, kind: i % 5 === 0 ? "card" : "page", project: `p${i % 20}`, links: 0 }));
  const edges = Array.from({ length: Math.round(n * 4.5) }, () => ({ from: Math.floor(next() * n), to: Math.floor(next() * n) })).filter((e) => e.from !== e.to);
  for (const e of edges) {
    nodes[e.from]!.links++;
    nodes[e.to]!.links++;
  }
  const places = new Float32Array(2 * n);
  for (let i = 0; i < 2 * n; i++) places[i] = (next() - 0.5) * 2000;
  return { model: modelOf({ nodes, edges }, SHOW_ALL), places };
}

const state = (over: Partial<DrawState> & Pick<DrawState, "model" | "places">): DrawState => ({
  width: 1000,
  height: 700,
  ratio: 1,
  cam: { x: 500, y: 350, k: 0.35 },
  palette: readPalette(),
  font: { size: 12, family: "sans-serif" },
  colourBy: "kind",
  hover: -1,
  lit: null,
  selected: -1,
  link: null,
  nameAll: false,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("Path2D", FakePath);
});
afterEach(() => vi.unstubAllGlobals());

describe("drawing the graph", () => {
  it("makes a node bigger with its links and its zoom, within limits", () => {
    expect(screenRadius(0, 1)).toBeLessThan(screenRadius(9, 1));
    expect(screenRadius(4, 0.25)).toBeLessThan(screenRadius(4, 4));
    expect(screenRadius(0, 0.001)).toBeGreaterThanOrEqual(2.2);
    expect(screenRadius(100000, 100)).toBe(24);
  });

  it("shortens a long title with an ellipsis, and leaves a short one", () => {
    expect(shorten("Short")).toBe("Short");
    expect(shorten("x".repeat(60))).toHaveLength(34);
    expect(shorten("x".repeat(60)).endsWith("…")).toBe(true);
  });

  it("draws nothing without places, and clears the canvas first", () => {
    const { model } = big(10);
    const { ctx, calls } = counting();
    drawGraph(ctx, state({ model, places: null as unknown as Float32Array }), tools);
    expect(calls.get("clearRect")).toBe(1);
    expect(calls.get("fill")).toBeUndefined();
  });

  it("names few nodes far out and more as it zooms in, the most linked first", () => {
    const { model, places } = big(600);
    const far = counting();
    drawGraph(far.ctx, state({ model, places, cam: { x: 500, y: 350, k: 0.2 } }), tools);
    const near = counting();
    drawGraph(near.ctx, state({ model, places, cam: { x: 500, y: 350, k: 1.6 } }), tools);
    expect(far.texts).toHaveLength(0);
    expect(near.texts.length).toBeGreaterThan(5);
    // A node under the pointer and its neighbours are always named.
    const lit = counting();
    drawGraph(lit.ctx, state({ model, places, cam: { x: 500, y: 350, k: 0.2 }, hover: 3, lit: new Set([3, ...model.neighbours[3]!]) }), tools);
    expect(lit.texts.length).toBeGreaterThan(0);
    expect(lit.texts).toContain(`Note number ${3}`);
  });

  it("draws a ten-thousand-note graph's links and nodes in a few strokes, and the code that builds them quickly", () => {
    const { model, places } = big(10_000);
    expect(model.edges.length).toBeGreaterThan(40_000);
    const { ctx, calls } = counting();
    const began = performance.now();
    drawGraph(ctx, state({ model, places }), tools);
    const took = performance.now() - began;
    // Batched: the strokes and fills are a handful, not one per node or link.
    expect(calls.get("stroke") ?? 0).toBeLessThan(20);
    expect(calls.get("fill") ?? 0).toBeLessThan(40);
    // The counting here is the JavaScript side only; the browser's own drawing is on top.
    expect(took).toBeLessThan(1500);
  });
});
