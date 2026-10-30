// A rehearsal in the presenter's view: the clock of `Rehearsal` joined to where the talk is. It times what the presenter does; it never
// moves the talk on, and nothing in it advances a slide.

import type { Deck } from "@kasten-slides/wasm";
import { useCallback, useEffect, useRef, useState } from "react";

import { type RehearsalRecord, type RunComparison, type Spot, type Timing, Rehearsal, compareRuns, lastRunFor, recordOf } from "./rehearsal.ts";
import type { RehearsalStore } from "./rehearsal-store.ts";

/** What the presenter's view is given to rehearse with. */
export interface RehearsalSetup {
  /** Where finished runs are kept and the last one is read from. */
  store: RehearsalStore;
  /** Start timing as soon as the view is up: the editor asked for a rehearsal. Once. */
  autoStart?: boolean;
  /** The time in milliseconds; the page's clock when left out. */
  clock?: () => number;
}

export type RehearsalPhase = "idle" | "running" | "paused" | "summary";

/** A run that has ended, with the last run to set it beside. */
export interface Finished {
  record: RehearsalRecord;
  comparison: RunComparison;
  /** Whether it has been kept. */
  saved: boolean;
  /** Why it could not be kept. */
  error: string | null;
}

export interface Rehearsing {
  phase: RehearsalPhase;
  /** What has been timed, up to when the view was last drawn. */
  timing: Timing;
  /** What has been timed, up to this moment. */
  timingNow(): Timing;
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  /** Ends the run and shows what it came to. */
  finish(): void;
  finished: Finished | null;
  save(): void;
  discard(): void;
}

const NOTHING: Timing = { totalMs: 0, slides: [] };

/**
 * The rehearsal of a talk at `spot` (a slide and a step; null while there is none). The view is drawn again as its clock moves, which
 * draws the time shown again. Without a setup there is no rehearsal and nothing here is used.
 */
export function useRehearsal(deck: Deck, spot: Spot | null, setup: RehearsalSetup | undefined): Rehearsing | null {
  const timer = useRef(new Rehearsal());
  const [phase, setPhaseState] = useState<RehearsalPhase>("idle");
  const phaseNow = useRef<RehearsalPhase>("idle");
  const [finished, setFinishedState] = useState<Finished | null>(null);
  const finishedNow = useRef<Finished | null>(null);
  const [, setRestarts] = useState(0);
  const clock = setup?.clock ?? Date.now;
  const latest = useRef({ deck, spot, setup, clock });
  latest.current = { deck, spot, setup, clock };
  const asked = useRef(false);

  const setPhase = useCallback((next: RehearsalPhase) => {
    phaseNow.current = next;
    setPhaseState(next);
  }, []);
  const setFinished = useCallback((next: Finished | null) => {
    finishedNow.current = next;
    setFinishedState(next);
  }, []);

  const start = useCallback(() => {
    const { spot: where, clock: time } = latest.current;
    timer.current.restart(time(), where ?? undefined);
    setFinished(null);
    setPhase("running");
  }, [setPhase, setFinished]);

  // The talk moves: the time from here on is that slide's and that step's.
  const slide = spot?.slide;
  const step = spot?.step;
  useEffect(() => {
    if ((phaseNow.current === "running" || phaseNow.current === "paused") && slide !== undefined && step !== undefined) timer.current.visit(slide, step, latest.current.clock());
  }, [slide, step]);

  const wanted = setup?.autoStart === true;
  const placed = slide !== undefined;
  useEffect(() => {
    if (!wanted || asked.current || !placed) return;
    asked.current = true;
    start();
  }, [wanted, placed, start]);

  const pause = useCallback(() => {
    if (phaseNow.current !== "running") return;
    timer.current.pause(latest.current.clock());
    setPhase("paused");
  }, [setPhase]);

  const resume = useCallback(() => {
    if (phaseNow.current !== "paused") return;
    timer.current.resume(latest.current.clock());
    setPhase("running");
  }, [setPhase]);

  const restart = useCallback(() => {
    if (phaseNow.current !== "running" && phaseNow.current !== "paused") return;
    const { spot: where, clock: time } = latest.current;
    timer.current.restart(time(), where ?? undefined);
    setPhase("running");
    // The phase may be what it was: the time shown still has to be drawn again.
    setRestarts((count) => count + 1);
  }, [setPhase]);

  const finish = useCallback(() => {
    if (phaseNow.current !== "running" && phaseNow.current !== "paused") return;
    const { deck: shown, setup: given, clock: time } = latest.current;
    const now = time();
    const record = recordOf(shown, timer.current.summary(now), now);
    setFinished({ record, comparison: compareRuns(record, undefined, shown), saved: false, error: null });
    setPhase("summary");
    // The last run to set it beside is read from where runs are kept; the summary is up meanwhile.
    void given?.store
      .list(shown.id)
      .then((runs) => {
        const current = finishedNow.current;
        if (current?.record === record) setFinished({ ...current, comparison: compareRuns(record, lastRunFor(runs, record.revision), shown) });
      })
      .catch(() => {});
  }, [setPhase, setFinished]);

  const save = useCallback(() => {
    const current = finishedNow.current;
    const given = latest.current.setup;
    if (!current || current.saved || !given) return;
    const record = current.record;
    const settle = (change: Partial<Finished>) => {
      const now = finishedNow.current;
      if (now?.record === record) setFinished({ ...now, ...change });
    };
    void given.store.save(record).then(
      () => settle({ saved: true, error: null }),
      (error: unknown) => settle({ error: error instanceof Error ? error.message : String(error) }),
    );
  }, [setFinished]);

  const discard = useCallback(() => {
    setFinished(null);
    timer.current.restart(latest.current.clock());
    setPhase("idle");
  }, [setPhase, setFinished]);

  if (!setup) return null;
  const timing = phase === "running" || phase === "paused" ? timer.current.summary(clock()) : NOTHING;
  // What has been timed, up to this moment: the bar that shows it asks again each second, so the view round it is not drawn again.
  const timingNow = (): Timing => (phaseNow.current === "running" || phaseNow.current === "paused" ? timer.current.summary(latest.current.clock()) : NOTHING);
  return { phase, timing, timingNow, start, pause, resume, restart, finish, finished, save, discard };
}
