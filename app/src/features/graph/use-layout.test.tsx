import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphNode } from "../../lib/vault/types";
import { SHOW_ALL, modelOf, type Model } from "./graph-model";
import { idHash } from "./places";
import { ticksFor, useLayout } from "./use-layout";

const node = (id: string, links = 0): GraphNode => ({ id, path: id, title: id, kind: "page", project: null, links });

/** a - b - c, and d on its own. */
const model = (): Model =>
  modelOf(
    {
      nodes: [node("a.md", 1), node("b.md", 2), node("c.md", 1), node("d.md")],
      edges: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ],
    },
    SHOW_ALL,
  );

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("laying a graph out for the view", () => {
  it("shows a picture at once, settles, and keeps where the nodes were left for the scope", async () => {
    const frames = vi.fn();
    const m = model();
    const first = renderHook(() => useLayout(m, "vault", frames));
    // From the first render there is a place for every node.
    expect(first.result.current.places.current).toHaveLength(8);
    await waitFor(() => expect(first.result.current.settled).toBe(true));
    expect(frames).toHaveBeenCalled();
    const settled = Array.from(first.result.current.places.current!);
    expect(settled.every(Number.isFinite)).toBe(true);
    first.unmount();

    // The next time the scope opens, nothing runs: it is settled where it was.
    const second = renderHook(() => useLayout(m, "vault", () => {}));
    await waitFor(() => expect(second.result.current.settled).toBe(true));
    const again = Array.from(second.result.current.places.current!);
    again.forEach((v, i) => expect(v).toBeCloseTo(settled[i]!, 0));
  });

  it("starts a scope of its own from scratch, and a shake from nothing", async () => {
    const m = model();
    const one = renderHook(() => useLayout(m, "project:a", () => {}));
    await waitFor(() => expect(one.result.current.settled).toBe(true));
    const kept = JSON.parse(localStorage.getItem("kasten.graph.places:project:a")!);
    expect(kept.k).toContain(idHash("a.md"));
    expect(localStorage.getItem("kasten.graph.places:vault")).toBeNull();
    one.unmount();

    const shaken = renderHook(({ round }) => useLayout(m, "project:a", () => {}, round), { initialProps: { round: 0 } });
    await waitFor(() => expect(shaken.result.current.settled).toBe(true));
    shaken.rerender({ round: 1 });
    // Starting afresh forgets the stored places, then lays out and keeps the new ones.
    await waitFor(() => expect(shaken.result.current.settled).toBe(true));
    expect(JSON.parse(localStorage.getItem("kasten.graph.places:project:a")!).k).toHaveLength(4);
  });

  it("puts a node that was not there beside its neighbours and settles warm", async () => {
    const m = model();
    const first = renderHook(({ model }) => useLayout(model, "vault", () => {}), { initialProps: { model: m } });
    await waitFor(() => expect(first.result.current.settled).toBe(true));
    const bigger = modelOf(
      {
        nodes: [node("a.md", 1), node("b.md", 3), node("c.md", 1), node("d.md"), node("e.md", 1)],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 1, to: 4 },
        ],
      },
      SHOW_ALL,
    );
    first.rerender({ model: bigger });
    expect(first.result.current.places.current).toHaveLength(10);
    await waitFor(() => expect(first.result.current.settled).toBe(true));
    const places = first.result.current.places.current!;
    const [bx, by, ex, ey] = [places[2]!, places[3]!, places[8]!, places[9]!];
    expect(Math.hypot(bx - ex, by - ey)).toBeLessThan(120);
  });

  it("places a node where it is told to before it joins the graph", async () => {
    const m = model();
    const run = renderHook(() => useLayout(m, "vault", () => {}));
    await waitFor(() => expect(run.result.current.settled).toBe(true));
    act(() => run.result.current.place("new.md", 42, -17));
    const kept = JSON.parse(localStorage.getItem("kasten.graph.places:vault")!);
    const at = kept.k.indexOf(idHash("new.md"));
    expect([kept.p[2 * at], kept.p[2 * at + 1]]).toEqual([42, -17]);
  });

  it("is told of an empty graph without laying out", async () => {
    const empty = modelOf({ nodes: [], edges: [] }, SHOW_ALL);
    const run = renderHook(() => useLayout(empty, "vault", () => {}));
    await waitFor(() => expect(run.result.current.settled).toBe(true));
    expect(run.result.current.places.current).toHaveLength(0);
  });

  it("keeps nothing in storage when told not to", async () => {
    const m = model();
    const run = renderHook(() => useLayout(m, "around:a.md:1", () => {}, 0, false));
    await waitFor(() => expect(run.result.current.settled).toBe(true));
    expect(localStorage.getItem("kasten.graph.places:around:a.md:1")).toBeNull();
  });

  it("gives big graphs fewer steps", () => {
    expect(ticksFor(100)).toBe(300);
    expect(ticksFor(3000)).toBe(200);
    expect(ticksFor(10_000)).toBe(120);
  });
});
