// The rehearsal's controls in the presenter's view: Rehearse starts a timed run; while it runs, Pause and Resume, Restart and Finish. They
// only time the talk. Nothing here moves it on.

import { type JSX, useEffect, useState } from "react";

import { durationText } from "./rehearsal-text.ts";
import type { Rehearsing } from "./useRehearsal.ts";

/** Draws the bar again each second while a run is timed (the view round it keeps still). */
function useSecond(on: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [on]);
}

export function RehearsalBar({ rehearsing }: { rehearsing: Rehearsing }): JSX.Element | null {
  const { phase } = rehearsing;
  useSecond(phase === "running");
  if (phase === "summary") return null;
  if (phase === "idle") {
    return (
      <div className="ks-pv-rehearsal" role="group" aria-label="Rehearsal">
        <button type="button" className="ks-pv-button" onClick={rehearsing.start} title="Time this run-through. Nothing moves by itself: you still go on with the keys or the buttons.">
          Rehearse
        </button>
      </div>
    );
  }
  const paused = phase === "paused";
  return (
    <div className="ks-pv-rehearsal is-running" role="group" aria-label="Rehearsal" data-phase={phase}>
      <span className="ks-pv-fact ks-pv-rehearsal-time" role="timer" aria-label="Rehearsal time">
        {durationText(rehearsing.timingNow().totalMs)}
      </span>
      <span className="ks-pv-rehearsal-state" role="status">
        {paused ? "Rehearsal paused" : "Rehearsing"}
      </span>
      <button type="button" className="ks-pv-button is-small" aria-pressed={paused} onClick={paused ? rehearsing.resume : rehearsing.pause}>
        {paused ? "Resume" : "Pause"}
      </button>
      <button type="button" className="ks-pv-button is-small" onClick={rehearsing.restart} title="Forget the time so far and begin again from this slide">
        Restart
      </button>
      <button type="button" className="ks-pv-button is-small is-primary" onClick={rehearsing.finish} title="End the run and see how long each slide took">
        Finish
      </button>
    </div>
  );
}
