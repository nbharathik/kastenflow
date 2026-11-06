// What a presentation is made of, apart from how it is drawn: the slides that are
// shown in the order they are shown in, the backup slides stacked under the slide
// above them, and where a person is (a slide, and how many steps of it are showing).
// The audience window, the presenter window and the tests all read the same plan,
// so two windows that show the same position show the same thing.
//
// The position is reveal.js's own: `h` is the column (a slide with its backups),
// `v` the place in the column (0 is the slide, 1 and up are its backups), and `f`
// the fragment showing (-1 when none is). A slide with N steps has N fragments, so
// the step it is at is `f + 1`, from 0 (as it appears) to N (as it ends).

import type { Deck, MotionDirection, Slide, TransitionKind } from "@kasten-slides/wasm";

/** A slide shown, with the backup slides that go under it. */
export interface Column {
  /** The slide, then its backups in order. */
  slides: Slide[];
}

export interface Plan {
  deck: Deck;
  /** Every slide that is shown (hidden ones are left out), in order: the columns, left to right. */
  columns: Column[];
  /** The place of each shown slide among the shown slides, from 1, for the slide-number field. */
  numbers: ReadonlyMap<string, number>;
  /** How many slides are shown (backups count). */
  count: number;
}

/** Where a person is. */
export interface Position {
  h: number;
  v: number;
  f: number;
}

/** What is on the screen at a position. */
export interface Spot {
  slide: Slide;
  /** 0 as the slide appears, up to its number of steps. */
  step: number;
  /** How many steps the slide has. */
  steps: number;
}

/** The clicks a slide has. */
export const stepsOf = (slide: Slide): number => Math.max(0, Math.floor(slide.steps ?? 0));

/**
 * The columns of a deck. A hidden slide is skipped, and so are the backups under a hidden
 * slide, which nobody could reach. A backup goes under the slide above it; one that has no slide
 * above it (a deck that begins with one) is a slide of its own.
 */
export function planOf(deck: Deck): Plan {
  const columns: Column[] = [];
  let skipping = false;
  for (const slide of deck.slides) {
    if (slide.hidden) {
      if (!slide.backup) skipping = true;
      continue;
    }
    if (slide.backup) {
      const column = columns[columns.length - 1];
      if (skipping) continue;
      if (column) column.slides.push(slide);
      else columns.push({ slides: [slide] });
      continue;
    }
    skipping = false;
    columns.push({ slides: [slide] });
  }
  const numbers = new Map<string, number>();
  for (const slide of deck.slides.filter((s) => !s.hidden)) numbers.set(slide.id, numbers.size + 1);
  return { deck, columns, numbers, count: numbers.size };
}

/** The slide at a place in the plan, or undefined when there is none. */
export function slideIn(plan: Plan, h: number, v: number): Slide | undefined {
  return plan.columns[h]?.slides[v];
}

/** Whether the deck has any backup slide, which is what makes up and down mean something. */
export const hasBackups = (plan: Plan): boolean => plan.columns.some((column) => column.slides.length > 1);

/** Keeps a position inside the plan, and its fragment inside the slide's steps. */
export function clampPosition(plan: Plan, position: Position): Position {
  const h = Math.min(Math.max(Math.trunc(position.h) || 0, 0), Math.max(plan.columns.length - 1, 0));
  const column = plan.columns[h];
  const v = Math.min(Math.max(Math.trunc(position.v) || 0, 0), Math.max((column?.slides.length ?? 1) - 1, 0));
  const slide = column?.slides[v];
  const steps = slide ? stepsOf(slide) : 0;
  const f = Number.isFinite(position.f) ? Math.trunc(position.f) : -1;
  return { h, v, f: Math.min(Math.max(f, -1), steps - 1) };
}

/** What is showing at a position. */
export function spotAt(plan: Plan, position: Position): Spot | null {
  const at = clampPosition(plan, position);
  const slide = slideIn(plan, at.h, at.v);
  if (!slide) return null;
  const steps = stepsOf(slide);
  return { slide, steps, step: Math.min(Math.max(at.f + 1, 0), steps) };
}

/** The position of a slide by id at a step; null for a slide that is not shown. */
export function positionOf(plan: Plan, slideId: string, step = 0): Position | null {
  for (let h = 0; h < plan.columns.length; h++) {
    const slides = plan.columns[h]?.slides ?? [];
    const v = slides.findIndex((slide) => slide.id === slideId);
    if (v >= 0) return clampPosition(plan, { h, v, f: step - 1 });
  }
  return null;
}

/**
 * Where "present from this slide" begins: `index` counts the deck's slides, hidden ones too. A slide that is
 * skipped begins at the next one that is shown, or the last one when nothing after it is.
 */
export function startPosition(plan: Plan, index: number): Position {
  const slides = plan.deck.slides;
  const from = Math.min(Math.max(Math.trunc(index) || 0, 0), Math.max(slides.length - 1, 0));
  for (let i = from; i < slides.length; i++) {
    const slide = slides[i];
    const found = slide ? positionOf(plan, slide.id) : null;
    if (found) return found;
  }
  return { h: Math.max(plan.columns.length - 1, 0), v: 0, f: -1 };
}

export type Direction = "right" | "left" | "down" | "up";

/**
 * Where a key takes a person, as reveal.js does it. Right shows the next step of the slide, else goes on to the
 * next slide, at its start. Left takes a step back, else goes back to the slide before it, as that ended. Down
 * and up go through a column's backup slides and never through steps. A backup is never reached by going right
 * or left; going along a row always lands on the slide at the top of a column.
 */
export function move(plan: Plan, position: Position, direction: Direction): Position {
  const at = clampPosition(plan, position);
  const spot = spotAt(plan, at);
  if (!spot) return at;
  const column = plan.columns[at.h];
  const last = (h: number, v: number): number => {
    const slide = slideIn(plan, h, v);
    return (slide ? stepsOf(slide) : 0) - 1;
  };
  switch (direction) {
    case "right":
      if (at.f + 1 < spot.steps) return { ...at, f: at.f + 1 };
      return at.h + 1 < plan.columns.length ? { h: at.h + 1, v: 0, f: -1 } : at;
    case "left":
      if (at.f >= 0) return { ...at, f: at.f - 1 };
      return at.h > 0 ? { h: at.h - 1, v: 0, f: last(at.h - 1, 0) } : at;
    case "down":
      return at.v + 1 < (column?.slides.length ?? 1) ? { h: at.h, v: at.v + 1, f: -1 } : at;
    case "up":
      return at.v > 0 ? { h: at.h, v: at.v - 1, f: last(at.h, at.v - 1) } : at;
  }
}

/** The first slide shown, and the last one (reveal.js's Home and End), each as it appears. */
export const firstPosition = (): Position => ({ h: 0, v: 0, f: -1 });
export const lastPosition = (plan: Plan): Position => ({ h: Math.max(plan.columns.length - 1, 0), v: 0, f: -1 });

export const samePosition = (a: Position, b: Position): boolean => a.h === b.h && a.v === b.v && a.f === b.f;

/** What reveal.js calls a position. */
export interface RevealState {
  indexh: number;
  indexv: number;
  indexf?: number | undefined;
  paused?: boolean | undefined;
  overview?: boolean | undefined;
}

/** The position in reveal.js's terms; the fragment is left out on a slide without steps, as reveal.js does. */
export function toState(plan: Plan, position: Position): RevealState {
  const at = clampPosition(plan, position);
  const slide = slideIn(plan, at.h, at.v);
  return { indexh: at.h, indexv: at.v, ...(slide && stepsOf(slide) > 0 ? { indexf: at.f } : {}) };
}

/** A position from reveal.js's state, kept inside the plan. */
export function fromState(plan: Plan, state: Pick<RevealState, "indexh" | "indexv" | "indexf">): Position {
  return clampPosition(plan, { h: state.indexh ?? 0, v: state.indexv ?? 0, f: state.indexf ?? -1 });
}

/**
 * The step a slide is drawn at, given where the person is: as far as they have got on the slide they are on, done on the
 * ones before it (reveal.js shows every step of a slide that is behind), and not begun on the ones after it.
 */
export function stepFor(plan: Plan, position: Position, h: number, v: number): number {
  const slide = slideIn(plan, h, v);
  if (!slide) return 0;
  const steps = stepsOf(slide);
  const at = clampPosition(plan, position);
  if (h === at.h && v === at.v) return Math.min(Math.max(at.f + 1, 0), steps);
  const behind = h < at.h || (h === at.h && v < at.v);
  return behind ? steps : 0;
}

/** How a slide arrives: what it says, else the deck's, else nothing. */
export interface Arrival {
  kind: TransitionKind;
  /** Seconds. */
  duration: number;
  easing: string | null;
  /** The side the slide comes from, for the kinds that have one. */
  direction: MotionDirection | null;
}

export const USUAL: Record<TransitionKind, number> = { none: 0, fade: 0.4, slide: 0.4, morph: 0.6, push: 0.5, wipe: 0.5, cover: 0.5, uncover: 0.5, zoom: 0.5, flip: 0.7, dissolve: 0.8 };

export function arrivalOf(deck: Deck, slide: Slide): Arrival {
  const own = slide.transition ?? deck.present.transition ?? null;
  const kind = own?.kind ?? "none";
  const duration = own?.duration != null && Number.isFinite(own.duration) && own.duration >= 0 ? own.duration : USUAL[kind];
  return { kind, duration: kind === "none" ? 0 : duration, easing: own?.easing ?? null, direction: own?.direction ?? null };
}

/**
 * Which slides morph into each other. Auto-Animate pairs two slides that carry the same id, and a slide can carry one,
 * so a run of slides that each morph from the one before shares one id: the run's first slide names it. A slide that
 * does not morph starts a new run (so it is not paired with the one before it).
 */
export function morphRuns(plan: Plan): Map<string, string> {
  const ids = new Map<string, string>();
  plan.columns.forEach((column, index) => {
    const slide = column.slides[0];
    const before = plan.columns[index - 1]?.slides[0];
    if (!slide || !before || arrivalOf(plan.deck, slide).kind !== "morph") return;
    const run = ids.get(before.id) ?? `morph-${before.id}`;
    ids.set(before.id, run);
    ids.set(slide.id, run);
  });
  return ids;
}
