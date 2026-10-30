// The time an answer has been working, ticking each second while it runs.

import { useEffect, useRef, useState } from "react";

import { startInterval } from "../../../lib/use-interval";

/** Seconds as a clock: 42 is "0:42", 3725 is "1:02:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** Whole seconds since `since` (the moment this window first saw it when unknown), counted again each second while `running`. */
export function useElapsed(since: number | undefined, running: boolean): number {
  const seen = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    // Rests while the window is hidden and reads the clock again the moment it returns.
    return startInterval(() => setNow(Date.now()), 1000);
  }, [running]);
  return Math.max(0, Math.floor((now - (since ?? seen.current)) / 1000));
}
