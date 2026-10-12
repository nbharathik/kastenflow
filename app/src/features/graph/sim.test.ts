import { describe, expect, it } from "vitest";

import { drive, layoutOf, type LayoutJob, type Tick } from "./drive";
import { settle } from "./layout";
import { serve } from "./sim-protocol";

const job = (over: Partial<LayoutJob> = {}): LayoutJob => ({
  count: 8,
  edges: Uint32Array.from([0, 1, 1, 2, 2, 0, 2, 3, 3, 4, 5, 6, 6, 7]),
  seed: 11,
  ...over,
});

/** A scheduler that runs what it is given when told to, in order. */
function queue() {
  const waiting: (() => void)[] = [];
  return {
    schedule: (run: () => void) => void waiting.push(run),
    drain(limit = 10_000) {
      for (let n = 0; waiting.length > 0 && n < limit; n++) waiting.shift()!();
    },
    get pending() {
      return waiting.length;
    },
  };
}

describe("the layout worker's loop", () => {
  it("runs in slices until the layout settles, and the last picture is the settled one", () => {
    const ticks: Tick[] = [];
    const q = queue();
    // A slice of no time runs one step, so the layout reports many times.
    drive(layoutOf(job({ ticks: 80 })), (t) => ticks.push(t), q.schedule, 0);
    q.drain();
    expect(ticks.length).toBeGreaterThan(5);
    expect(ticks.slice(0, -1).every((t) => !t.settled)).toBe(true);
    const last = ticks.at(-1)!;
    expect(last.settled).toBe(true);
    expect(last.steps).toBeLessThanOrEqual(80);
    expect(q.pending).toBe(0);
  });

  it("settles to the same picture whatever the slicing and every time for a seed", () => {
    const direct = settle(8, job().edges, { seed: 11 });
    const sliced: Tick[] = [];
    const q = queue();
    drive(layoutOf(job()), (t) => sliced.push(t), q.schedule, 0);
    q.drain();
    expect(Array.from(sliced.at(-1)!.positions)).toEqual(Array.from(direct));
    const fast: Tick[] = [];
    const q2 = queue();
    drive(layoutOf(job()), (t) => fast.push(t), q2.schedule, 1000);
    q2.drain();
    expect(fast.length).toBe(1);
    expect(Array.from(fast[0]!.positions)).toEqual(Array.from(direct));
  });

  it("can be stopped between slices", () => {
    const ticks: Tick[] = [];
    const q = queue();
    const stop = drive(layoutOf(job()), (t) => ticks.push(t), q.schedule, 0);
    q.drain(3);
    stop();
    const heard = ticks.length;
    q.drain();
    expect(ticks.length).toBe(heard);
    expect(ticks.at(-1)!.settled).toBe(false);
  });
});

describe("serving the worker's messages", () => {
  it("lays out the graph it is sent, the same way for the same seed", () => {
    const run = () => {
      const ticks: Tick[] = [];
      const q = queue();
      serve((t) => ticks.push(t), q.schedule)(job());
      q.drain();
      return ticks.at(-1)!;
    };
    const first = run();
    const second = run();
    expect(first.settled).toBe(true);
    expect(Array.from(second.positions)).toEqual(Array.from(first.positions));
    expect(first.positions.length).toBe(16);
    expect(Array.from(first.positions).every(Number.isFinite)).toBe(true);
  });

  it("drops the layout it was running when a new graph arrives or when told to stop", () => {
    const ticks: Tick[] = [];
    const q = queue();
    const handle = serve((t) => ticks.push(t), q.schedule);
    handle(job({ count: 8 }));
    q.drain(2);
    handle(job({ count: 3, edges: Uint32Array.from([0, 1]) }));
    ticks.length = 0;
    q.drain();
    // Only the second graph's pictures follow.
    expect(ticks.every((t) => t.positions.length === 6)).toBe(true);
    expect(ticks.at(-1)!.settled).toBe(true);

    const before = ticks.length;
    handle(job());
    handle("stop");
    q.drain();
    expect(ticks.length).toBe(before);
  });
});
