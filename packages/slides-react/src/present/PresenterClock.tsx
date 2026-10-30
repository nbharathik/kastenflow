// The clock and the timer of the presenter's view. They are drawn again every second, so they are a part of their own: the two
// slides beside them are drawn again only when the talk moves.

import { type JSX, useEffect, useState } from "react";

import { type Stopwatch, elapsedAt } from "./stopwatch.ts";

const two = (n: number): string => String(n).padStart(2, "0");

/** `12:03` or `1:12:03`. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(total % 60)}` : `${two(m)}:${two(total % 60)}`;
}

/** The time now, refreshed each second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

export interface PresenterClockProps {
  watch: Stopwatch;
  onToggle(): void;
  onReset(): void;
}

export function PresenterClock({ watch, onToggle, onReset }: PresenterClockProps): JSX.Element {
  const now = useNow();
  const clock = new Date(now);
  const paused = watch.stoppedAt !== null;
  return (
    <>
      <span className="ks-pv-fact ks-pv-clock" data-fact="clock" aria-label="Time now">
        {two(clock.getHours())}:{two(clock.getMinutes())}
      </span>
      <span className="ks-pv-fact ks-pv-timer" data-fact="timer" role="timer" aria-label={paused ? "Time spent, paused" : "Time spent"}>
        {elapsedText(elapsedAt(watch, now))}
        <button type="button" className="ks-pv-button is-small" onClick={onToggle} aria-pressed={paused} title={paused ? "Start timing again (T)" : "Pause the timer (T)"}>
          {paused ? "Start" : "Stop"}
        </button>
        <button type="button" className="ks-pv-button is-small" onClick={onReset} title="Start the timer again (R)">
          Reset
        </button>
      </span>
    </>
  );
}
