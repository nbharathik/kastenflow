// The presenter's timer: how long the talk has gone on, which can be stopped for a break and started again from nothing.
// It is a value (no clock inside), so what it says at a time can be told without waiting for that time.

export interface Stopwatch {
  /** When it counts from, in milliseconds. */
  start: number;
  /** When it was stopped, or null while it runs. */
  stoppedAt: number | null;
}

export const stopwatchFrom = (start: number): Stopwatch => ({ start, stoppedAt: null });

/** How long it has run at `now`, in milliseconds. */
export const elapsedAt = (watch: Stopwatch, now: number): number => Math.max(0, (watch.stoppedAt ?? now) - watch.start);

/** Stopped when it runs; running again, without the time of the stop, when it is stopped. */
export function toggled(watch: Stopwatch, now: number): Stopwatch {
  return watch.stoppedAt === null ? { start: watch.start, stoppedAt: now } : { start: watch.start + (now - watch.stoppedAt), stoppedAt: null };
}
