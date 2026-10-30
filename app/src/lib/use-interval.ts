// Timers that rest while the window is hidden: a poll runs every `ms` while
// the window is visible, and once more at once when it becomes visible again
// (it may have missed beats). One place for it, so an idle window stays quiet.

import { useEffect, useRef } from "react";

import { onWake } from "./wake";

const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** Runs `run` every `ms` while the window is visible; on becoming visible
 * again it runs once at once. Does not run at the start. Returns how to stop. */
export function startInterval(run: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  // A beat that finds the window hidden also stops, in case no change event came.
  const tick = () => {
    if (visible()) run();
    else stop();
  };
  const start = () => {
    if (timer === null) timer = setInterval(tick, ms);
  };
  const onChange = () => {
    if (visible()) {
      run();
      start();
    } else {
      stop();
    }
  };
  // After a sleep or a clock change the beat starts over, so the next one is a full period away.
  const onWoke = () => {
    if (!visible()) return;
    stop();
    run();
    start();
  };
  if (visible()) start();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onChange);
  const stopWake = onWake(onWoke);
  return () => {
    stop();
    stopWake();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onChange);
  };
}

/** `startInterval` for a component: runs while mounted and `active` (a panel
 * or row that is shown), always with the latest `run`. */
export function useInterval(run: () => void, ms: number, active = true): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!active) return;
    return startInterval(() => latest.current(), ms);
  }, [ms, active]);
}
