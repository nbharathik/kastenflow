// The keys of a focused bar. Arrows move to the bar next to it; Alt with ←
// or → shifts its dates a day (the keyboard's way of dragging), with Shift
// as well it moves only the end (resizing); Enter opens the note. Pure, unit
// tested: the view only acts on what these say.

import type { Grip } from "./layout";

/** A bar placed in a row of the grid, for finding its neighbours. */
export interface Placed {
  id: string;
  /** Pixel position of its middle. */
  centre: number;
}

/** The rows of the grid from top to bottom, the bars of each from left to right. */
export type Rows = readonly (readonly Placed[])[];

export type Step = "left" | "right" | "up" | "down" | "first" | "last";

const STEPS: Record<string, Step> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Home: "first", End: "last" };

export type Action = { kind: "focus"; step: Step } | { kind: "shift"; grip: Grip; days: 1 | -1 } | { kind: "open" };

interface KeyLike {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** What a key on a bar asks for, or null for one that is not the timeline's. */
export function actionOf(event: KeyLike): Action | null {
  if (event.ctrlKey || event.metaKey) return null;
  if (event.key === "Enter") return event.altKey || event.shiftKey ? null : { kind: "open" };
  const step = STEPS[event.key];
  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    return { kind: "shift", grip: event.shiftKey ? "end" : "move", days: event.key === "ArrowLeft" ? -1 : 1 };
  }
  if (event.altKey || event.shiftKey || !step) return null;
  return { kind: "focus", step };
}

/** The bar to focus after `step` from `id`: along the row for ← →, the
 * nearest by position in the next row for ↑ ↓, the ends of the row for Home
 * and End. Stays put at an edge; null when `id` is not in the rows. */
export function neighbour(rows: Rows, id: string, step: Step): string | null {
  const r = rows.findIndex((row) => row.some((bar) => bar.id === id));
  if (r < 0) return null;
  const row = rows[r]!;
  const at = row.findIndex((bar) => bar.id === id);
  switch (step) {
    case "left":
      return row[Math.max(at - 1, 0)]!.id;
    case "right":
      return row[Math.min(at + 1, row.length - 1)]!.id;
    case "first":
      return row[0]!.id;
    case "last":
      return row[row.length - 1]!.id;
    default: {
      const next = rows.slice(step === "up" ? 0 : r + 1, step === "up" ? r : undefined);
      const target = step === "up" ? [...next].reverse().find((candidate) => candidate.length > 0) : next.find((candidate) => candidate.length > 0);
      if (!target) return id;
      const here = row[at]!.centre;
      return target.reduce((best, bar) => (Math.abs(bar.centre - here) < Math.abs(best.centre - here) ? bar : best)).id;
    }
  }
}
