// How a rehearsal went against a plan: which slides ran over their time and which under, how fast the notes were got through, and a line
// for the end. Pure: it reads the deck's notes and the run, and nothing else.
//
// A slide's plan is its share of the time the person aimed for (shared out by how much there is to say, from the notes), or, when they aimed
// for no time, what its notes take to say aloud at a steady pace. A slide with no plan is never over or under.

import type { Deck } from "@kasten-slides/wasm";

import { slideTitle } from "../editor/dialogs/slide-title.ts";
import type { RehearsalRecord } from "./rehearsal.ts";

/** Words a minute of a steady talk. */
export const STEADY_WPM = 130;
/** Faster than this is hurried, slower than this is dragging. */
export const FAST_WPM = 170;
export const SLOW_WPM = 100;
/** A slide's plan is never under this when it comes from notes, and a slide with fewer note words has no plan of its own. */
const LEAST_PLAN_MS = 20_000;
const LEAST_NOTE_WORDS = 5;
/** Notes too short, or a stay too brief, say nothing about pace. */
const LEAST_PACE_WORDS = 15;
const LEAST_PACE_MS = 5_000;
/** How far from the plan still counts as on time: this share of it, but not under five seconds. */
const TOLERANCE = 0.15;
const LEAST_TOLERANCE_MS = 5_000;
/** Every slide has this much weight before its notes add to it, so a slide with no notes still gets a share of a target time. */
const BASE_WEIGHT = 60;

export type PaceStatus = "over" | "under" | "on";
export type Tempo = "fast" | "steady" | "slow";

export interface PaceRow {
  id: string;
  title: string;
  ms: number;
  /** The time planned for the slide; none when there is no plan for it. */
  plannedMs?: number;
  /** `ms` less `plannedMs`. */
  deltaMs?: number;
  status?: PaceStatus;
  /** Words of notes a minute, when the notes are long enough and the stay long enough to say. */
  wordsPerMinute?: number;
  tempo?: Tempo;
}

export interface PaceSummary {
  rows: PaceRow[];
  over: number;
  under: number;
  on: number;
  /** The time planned for the slides that have a plan, and how far the run was from it in all. */
  plannedMs: number;
  deltaMs: number;
  /** The slides were planned from a target time; otherwise from their notes. */
  fromTarget: boolean;
}

/** How many words a text of notes has (marks that are not words do not count). */
export function wordsIn(text: string | undefined): number {
  return (text ?? "").split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

const tempoOf = (wpm: number): Tempo => (wpm > FAST_WPM ? "fast" : wpm < SLOW_WPM ? "slow" : "steady");

/** How the run went against the plan, for the slides it timed in the deck's order. */
export function paceOf(deck: Pick<Deck, "slides">, record: Pick<RehearsalRecord, "slides" | "targetMs">): PaceSummary {
  const timed = new Map(record.slides.map((slide) => [slide.id, slide.ms]));
  const slides = deck.slides.filter((slide) => timed.has(slide.id));
  const target = record.targetMs !== undefined && record.targetMs > 0 ? record.targetMs : undefined;
  const weights = slides.map((slide) => BASE_WEIGHT + wordsIn(slide.notes));
  const sum = weights.reduce((a, b) => a + b, 0);
  const rows = slides.map((slide, i): PaceRow => {
    const ms = timed.get(slide.id) ?? 0;
    const words = wordsIn(slide.notes);
    const planned =
      target !== undefined && sum > 0
        ? Math.round((target * (weights[i] ?? 0)) / sum)
        : words >= LEAST_NOTE_WORDS
          ? Math.max(LEAST_PLAN_MS, Math.round((words / STEADY_WPM) * 60_000))
          : undefined;
    const row: PaceRow = { id: slide.id, title: slideTitle(slide), ms };
    if (planned !== undefined) {
      const delta = ms - planned;
      const slack = Math.max(LEAST_TOLERANCE_MS, planned * TOLERANCE);
      row.plannedMs = planned;
      row.deltaMs = delta;
      row.status = Math.abs(delta) <= slack ? "on" : delta > 0 ? "over" : "under";
    }
    if (words >= LEAST_PACE_WORDS && ms >= LEAST_PACE_MS) {
      row.wordsPerMinute = Math.round(words / (ms / 60_000));
      row.tempo = tempoOf(row.wordsPerMinute);
    }
    return row;
  });
  const planned = rows.filter((row) => row.plannedMs !== undefined);
  return {
    rows,
    over: rows.filter((row) => row.status === "over").length,
    under: rows.filter((row) => row.status === "under").length,
    on: rows.filter((row) => row.status === "on").length,
    plannedMs: planned.reduce((sum, row) => sum + (row.plannedMs ?? 0), 0),
    deltaMs: planned.reduce((sum, row) => sum + (row.deltaMs ?? 0), 0),
    fromTarget: target !== undefined,
  };
}

const slidesWord = (n: number): string => `${n} slide${n === 1 ? "" : "s"}`;

/** The line at the end: how many slides ran over and under, or that there was no plan to compare with. */
export function headline(summary: PaceSummary): string {
  const planned = summary.over + summary.under + summary.on;
  if (planned === 0) return "There was no plan to compare with: set a target time, or write speaker notes, and the next run is measured against it.";
  const parts: string[] = [];
  if (summary.over > 0) parts.push(`${slidesWord(summary.over)} ran over`);
  if (summary.under > 0) parts.push(`${slidesWord(summary.under)} under`);
  if (summary.on > 0 && parts.length === 0) return `Every slide kept to its time (${slidesWord(summary.on)}).`;
  if (summary.on > 0) parts.push(`${summary.on} on time`);
  return `${parts.join(", ")}.`.replace(/^./, (c) => c.toUpperCase());
}
