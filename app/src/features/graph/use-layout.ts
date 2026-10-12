// Laying a graph out as the view shows it: the nodes start where this scope
// left them last time (so it opens settled), a worker moves what is new or
// what changed, and the places are written back once it settles. The picture
// is kept in a ref and announced with a callback, not React state: it
// changes dozens of times a second while the layout runs.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { Layout } from "./layout";
import type { Model } from "./graph-model";
import { Places, idHash } from "./places";
import { runLayout } from "./run-layout";

/** The step budget by size: a big graph is read from afar, so it gets fewer. */
export const ticksFor = (count: number): number => (count <= 1500 ? 300 : count <= 6000 ? 200 : 120);

export interface LayoutRun {
  /** x, y pairs for the model's nodes; null before there are any. */
  places: RefObject<Float32Array | null>;
  /** The layout has stopped (cooled, or out of steps). */
  settled: boolean;
  /** Says where a node that is about to join the graph should appear (a page made by a double click). */
  place(id: string, x: number, y: number): void;
}

/**
 * `scope` names what the places belong to. `onFrame` is called whenever the
 * picture changes. A `round` above 0 starts from nothing: the shake button.
 * With `persist` off the places are not kept in storage (a small graph that
 * belongs to a page, not to a scope the person returns to).
 */
export function useLayout(model: Model, scope: string, onFrame: () => void, round = 0, persist = true): LayoutRun {
  const places = useRef<Float32Array | null>(null);
  const [settled, setSettled] = useState(false);
  const memory = useRef<Places | null>(null);
  const frame = useRef(onFrame);
  useEffect(() => {
    frame.current = onFrame;
  });

  useEffect(() => {
    if (!memory.current) memory.current = new Places(scope, persist);
    else memory.current.switchTo(scope);
    const kept = memory.current;
    if (round > 0) kept.clear();
    const ids = model.nodes.map((n) => n.id);
    const count = ids.length;
    if (count === 0) {
      places.current = new Float32Array(0);
      setSettled(true);
      frame.current();
      return;
    }
    const edges = new Uint32Array(model.edges.length * 2);
    model.edges.forEach((e, i) => {
      edges[2 * i] = e.from;
      edges[2 * i + 1] = e.to;
    });
    const { start, known } = kept.start(ids);
    const seed = idHash(`${scope}:${round}`);
    // Shown at once from what is known; the rest is placed beside its neighbours.
    places.current = new Layout(count, edges, { start: known > 0 ? start : null, seed, heat: 0 }).positions();
    frame.current();
    if (known === count) {
      setSettled(true);
      return;
    }
    setSettled(false);
    let latest: Float32Array | null = null;
    const stop = runLayout({ count, edges, start: known > 0 ? start : null, seed, ticks: ticksFor(count), heat: known === 0 ? 1 : known / count > 0.5 ? 0.35 : 0.7 }, (tick) => {
      latest = tick.positions;
      places.current = tick.positions;
      frame.current();
      if (tick.settled) {
        kept.remember(ids, tick.positions);
        kept.save();
        setSettled(true);
      }
    });
    return () => {
      stop();
      // Where it had got to is kept for the next layout of these nodes.
      if (latest) kept.remember(ids, latest);
    };
  }, [model, scope, round, persist]);

  const place = useCallback((id: string, x: number, y: number) => {
    memory.current?.remember([id], [x, y]);
    memory.current?.save();
  }, []);

  return { places, settled, place };
}
