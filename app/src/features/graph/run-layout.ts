// Starting a layout: in a Web Worker where the window has them, so a big
// graph never holds up typing or scrolling, else in slices on this thread
// (small graphs, tests, or a window that will not start the worker).

import { drive, layoutOf, type LayoutJob, type Tick } from "./drive";

/** Runs `job`, calling `onTick` as it goes; the function returned stops it. */
export function runLayout(job: LayoutJob, onTick: (tick: Tick) => void): () => void {
  const here = () => drive(layoutOf(job), onTick);
  if (typeof Worker === "undefined") return here();
  let stop: () => void;
  try {
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    let heard = false;
    worker.onmessage = (event: MessageEvent<Tick>) => {
      heard = true;
      onTick(event.data);
    };
    // A worker that cannot start (a policy that refuses it) hands the job to this thread.
    worker.onerror = () => {
      worker.terminate();
      if (!heard) stop = here();
    };
    // The job's arrays are copied: the caller keeps its own.
    worker.postMessage(job);
    stop = () => worker.terminate();
  } catch {
    stop = here();
  }
  return () => stop();
}
