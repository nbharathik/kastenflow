// Running a layout in slices: a few steps at a time, each slice short
// enough that whatever shares the thread (the worker's inbox, or the window
// when there is no worker) stays responsive, with the picture reported after
// each slice.

import { Layout, type LayoutOptions } from "./layout";

/** A layout to run: the graph as counts and index pairs, and how to start. */
export interface LayoutJob extends LayoutOptions {
  count: number;
  /** Source and target indices in pairs. */
  edges: Uint32Array;
  /** x, y pairs to start from, NaN where a node has none. */
  start?: Float64Array | null;
}

export interface Tick {
  /** x, y pairs. */
  positions: Float32Array;
  settled: boolean;
  steps: number;
}

/** Milliseconds of stepping per slice. */
const SLICE_MS = 12;

/** Steps `layout` in slices until it settles, reporting each; the function returned stops it. */
export function drive(layout: Layout, report: (tick: Tick) => void, schedule: (run: () => void) => void = (run) => void setTimeout(run, 0), sliceMs = SLICE_MS): () => void {
  let stopped = false;
  const slice = () => {
    if (stopped) return;
    const began = performance.now();
    do layout.step();
    while (!layout.settled && performance.now() - began < sliceMs);
    report({ positions: layout.positions(), settled: layout.settled, steps: layout.steps });
    if (!layout.settled) schedule(slice);
  };
  schedule(slice);
  return () => {
    stopped = true;
  };
}

export const layoutOf = (job: LayoutJob): Layout => new Layout(job.count, job.edges, job);
