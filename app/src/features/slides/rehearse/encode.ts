// A rehearsal as the app's store keeps it. The store (src-tauri/src/rehearsals.rs) keeps `{at, totalMs, slides: [{id, ms}], targetMs?}` for
// each run of a deck and nothing else, so what a run of the Slides package also knows (which version of the deck it timed, and the time of each
// step) is written as entries of that list that no slide has an id of:
//
//   revision:<16 hex digits>     the revision of the deck, with no time
//   <slide id>#<step>            the part of a slide's time spent at a step
//
// Reading puts them back. A run kept by an older build, or by hand, has no revision and reads as one of an earlier version of the deck.

import type { RehearsalRecord, SlideTime } from "@kasten-slides/react";

/** One entry of a stored run. */
export interface StoredSlide {
  id: string;
  ms: number;
}

/** A run as the store keeps it. */
export interface StoredRun {
  at: number | string;
  totalMs: number;
  slides: StoredSlide[];
  targetMs?: number;
}

const REVISION = "revision:";

/** The run for the store. */
export function toStored(record: RehearsalRecord): StoredRun {
  const slides: StoredSlide[] = [{ id: `${REVISION}${record.revision}`, ms: 0 }];
  for (const slide of record.slides) {
    slides.push({ id: slide.id, ms: Math.max(0, Math.round(slide.ms)) });
    for (const step of slide.steps) if (step.ms > 0) slides.push({ id: `${slide.id}#${step.step}`, ms: Math.round(step.ms) });
  }
  return { at: record.at, totalMs: Math.max(0, Math.round(record.totalMs)), slides, ...(record.targetMs !== undefined ? { targetMs: record.targetMs } : {}) };
}

/** The run of the Slides package that a stored one is. */
export function fromStored(deckId: string, stored: StoredRun): RehearsalRecord {
  let revision = "";
  const slides = new Map<string, SlideTime>();
  const steps = new Map<string, { step: number; ms: number }[]>();
  for (const entry of stored.slides) {
    if (entry.id.startsWith(REVISION)) {
      revision = entry.id.slice(REVISION.length);
      continue;
    }
    const at = entry.id.lastIndexOf("#");
    const step = at > 0 ? Number(entry.id.slice(at + 1)) : Number.NaN;
    if (at > 0 && Number.isInteger(step) && step >= 0) {
      const id = entry.id.slice(0, at);
      steps.set(id, [...(steps.get(id) ?? []), { step, ms: entry.ms }]);
    } else {
      slides.set(entry.id, { id: entry.id, ms: entry.ms, visits: 1, steps: [] });
    }
  }
  for (const [id, list] of steps) {
    const slide = slides.get(id);
    if (slide) slide.steps = list.sort((a, b) => a.step - b.step);
  }
  const at = typeof stored.at === "number" ? stored.at : Date.parse(stored.at);
  return {
    deckId,
    revision,
    at: Number.isFinite(at) ? at : 0,
    totalMs: stored.totalMs,
    ...(stored.targetMs !== undefined && stored.targetMs !== null ? { targetMs: stored.targetMs } : {}),
    slides: [...slides.values()],
  };
}
