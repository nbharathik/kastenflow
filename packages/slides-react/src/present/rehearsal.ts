// A rehearsal: how long a talk spends on each slide and each step of it. The model is pure: it is told the time (`now`, in
// milliseconds) with every call, so a clock never has to be faked and a test can say an hour went by. It times; it never moves the
// talk on by itself, and nothing here advances a slide.

import type { Deck } from "@kasten-slides/wasm";

import { slideTitle } from "../editor/dialogs/slide-title.ts";

/** The time spent at one step of a slide (0 is the slide as it appears). */
export interface StepTime {
  step: number;
  ms: number;
}

/** The time spent on a slide, how many times it was gone to, and the part of it spent at each step. */
export interface SlideTime {
  id: string;
  ms: number;
  visits: number;
  steps: StepTime[];
}

/** What a rehearsal has timed so far: the slides in the order they were first visited. */
export interface Timing {
  totalMs: number;
  slides: SlideTime[];
}

/** A rehearsal that was kept. */
export interface RehearsalRecord {
  /** The deck it timed (`deck.id`). */
  deckId: string;
  /** What the deck's slides and steps were then (`revisionOf`): a run of another revision compares by slide id and is marked outdated. */
  revision: string;
  /** When it ended, in milliseconds since 1970. */
  at: number;
  totalMs: number;
  /** The time the person aimed for, when they set one. */
  targetMs?: number;
  slides: SlideTime[];
}

/** Where the talk is: a slide and the step of it showing. */
export interface Spot {
  slide: string;
  step: number;
}

/** FNV-1a, 64 bits, as 16 hex digits. */
function fnv(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * What a deck's rehearsals are about: its id and the id and steps of each of its slides, in order. A run of a deck whose slides or steps
 * have changed is of another revision; what is written on the slides is not part of it.
 */
export function revisionOf(deck: Pick<Deck, "id" | "slides">): string {
  return fnv([deck.id, ...deck.slides.map((slide) => `${slide.id}:${Math.max(0, Math.floor(slide.steps ?? 0))}`)].join("\n"));
}

const later = (now: number, since: number): number => Math.max(0, now - since);

/** The clock of a rehearsal: it runs from one visit to the next, stops at a pause, and starts again on a resume. */
export class Rehearsal {
  private order: string[] = [];
  private ms = new Map<string, number>();
  private visits = new Map<string, number>();
  private steps = new Map<string, Map<number, number>>();
  private at: Spot | null = null;
  /** When the open span began; null before the first visit and while paused. */
  private since: number | null = null;
  private held = false;

  get paused(): boolean {
    return this.held;
  }

  /** Whether it has been told where the talk is. */
  get started(): boolean {
    return this.at !== null;
  }

  private add(spot: Spot, ms: number): void {
    this.ms.set(spot.slide, (this.ms.get(spot.slide) ?? 0) + ms);
    const steps = this.steps.get(spot.slide) ?? new Map<number, number>();
    steps.set(spot.step, (steps.get(spot.step) ?? 0) + ms);
    this.steps.set(spot.slide, steps);
  }

  /** Ends the open span at `now`. */
  private close(now: number): void {
    if (this.at && this.since !== null) this.add(this.at, later(now, this.since));
    this.since = null;
  }

  /** The talk is at this slide and step from `now`. A step of the slide it was on is no new visit; coming back to a slide is one. */
  visit(slide: string, step: number, now: number): void {
    this.close(now);
    if (this.at?.slide !== slide || !this.order.includes(slide)) {
      if (!this.order.includes(slide)) {
        this.order.push(slide);
        this.ms.set(slide, 0);
        this.visits.set(slide, 0);
      }
      this.visits.set(slide, (this.visits.get(slide) ?? 0) + 1);
    }
    this.at = { slide, step };
    this.since = this.held ? null : now;
  }

  /** Stops the clock. The time until `now` counts; the time paused does not. */
  pause(now: number): void {
    if (this.held) return;
    this.close(now);
    this.held = true;
  }

  /** Starts the clock again from `now`, on the slide the talk is at. */
  resume(now: number): void {
    if (!this.held) return;
    this.held = false;
    if (this.at) this.since = now;
  }

  /** Forgets everything and runs again from `now`, beginning at `at` when the talk is somewhere. */
  restart(now: number, at?: Spot): void {
    this.order = [];
    this.ms.clear();
    this.visits.clear();
    this.steps.clear();
    this.at = null;
    this.since = null;
    this.held = false;
    if (at) this.visit(at.slide, at.step, now);
  }

  /** What has been timed, up to `now`. The open span counts to `now` without being closed. */
  summary(now: number): Timing {
    const open = this.at && this.since !== null ? { spot: this.at, ms: later(now, this.since) } : null;
    const slides = this.order.map((id): SlideTime => {
      const steps = new Map(this.steps.get(id) ?? []);
      let ms = this.ms.get(id) ?? 0;
      if (open && open.spot.slide === id) {
        ms += open.ms;
        steps.set(open.spot.step, (steps.get(open.spot.step) ?? 0) + open.ms);
      }
      return {
        id,
        ms,
        visits: this.visits.get(id) ?? 0,
        steps: [...steps].map(([step, time]) => ({ step, ms: time })).sort((a, b) => a.step - b.step),
      };
    });
    return { totalMs: slides.reduce((sum, slide) => sum + slide.ms, 0), slides };
  }
}

/** A rehearsal to keep: what was timed, for this deck as it is now. */
export function recordOf(deck: Pick<Deck, "id" | "slides">, timing: Timing, at: number, targetMs?: number): RehearsalRecord {
  return {
    deckId: deck.id,
    revision: revisionOf(deck),
    at,
    totalMs: timing.totalMs,
    ...(targetMs !== undefined ? { targetMs } : {}),
    slides: timing.slides,
  };
}

/** One slide of a run beside the same slide of the run before. */
export interface RunRow {
  id: string;
  title: string;
  ms: number;
  /** The time on the same slide in the run before; none when that run did not time it. */
  previousMs?: number;
  /** `ms` less `previousMs`: positive when it took longer this time. */
  deltaMs?: number;
}

/** A run beside the one before it. */
export interface RunComparison {
  /** The run before was of an earlier revision of the deck: the slides are compared by their id, and some may not be there. */
  outdated: boolean;
  /** The slides the run timed, in the deck's order. */
  rows: RunRow[];
}

/** A run compared with the one before it, slide by slide. `previous` is the last run of the same revision, or an older one (then it is `outdated`). */
export function compareRuns(current: RehearsalRecord, previous: RehearsalRecord | undefined, deck: Pick<Deck, "slides">): RunComparison {
  const before = new Map(previous?.slides.map((slide) => [slide.id, slide.ms]));
  const timed = new Map(current.slides.map((slide) => [slide.id, slide.ms]));
  const rows: RunRow[] = [];
  for (const slide of deck.slides) {
    const ms = timed.get(slide.id);
    if (ms === undefined) continue;
    const previousMs = before.get(slide.id);
    rows.push({ id: slide.id, title: slideTitle(slide), ms, ...(previousMs !== undefined ? { previousMs, deltaMs: ms - previousMs } : {}) });
  }
  return { outdated: previous !== undefined && previous.revision !== current.revision, rows };
}

/** The last run to compare a new one with: the latest of the same revision, else the latest of all. */
export function lastRunFor(records: readonly RehearsalRecord[], revision: string): RehearsalRecord | undefined {
  return [...records].reverse().find((record) => record.revision === revision) ?? records[records.length - 1];
}
