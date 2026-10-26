// A clock a test moves by hand: nothing runs until `advance` says time passed.

import type { DemoClock } from "./clock";

export interface FakeClock extends DemoClock {
  advance(ms: number): void;
}

export function fakeClock(start = Date.parse("2026-10-06T09:30:00Z")): FakeClock {
  let now = start;
  const waiting = new Set<{ at: number; run: () => void }>();
  return {
    now: () => now,
    after(ms, run) {
      const item = { at: now + ms, run };
      waiting.add(item);
      return () => void waiting.delete(item);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...waiting].filter((w) => w.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        waiting.delete(next);
        now = next.at;
        next.run();
      }
      now = until;
    },
  };
}
