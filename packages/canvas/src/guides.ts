// The shapes snapping speaks in, and the small helpers its two halves share.

import type { Rect } from "./geometry.ts";

export type Axis = "x" | "y";

export type GuideKind = "edge" | "centre" | "margin" | "spacing" | "guide";

/**
 * A line to draw. An `x` guide is a vertical line at x = `at`, running from
 * y = `from` to y = `to`; a `y` guide is the horizontal counterpart. A
 * `spacing` guide marks a gap: a `y` guide runs across the gap between two
 * boxes side by side (at height `at`, from the edge of one to the edge of the
 * next), and an `x` guide down the gap between two boxes one above the other.
 */
export interface Guide {
  axis: Axis;
  at: number;
  from: number;
  to: number;
  kind: GuideKind;
}

/** The slide the boxes sit on. `margin` adds guides that far in from each side. */
export interface Frame {
  width: number;
  height: number;
  margin?: number;
  /** Lines a person drew: `x` are vertical ones, at a distance from the left; `y` horizontal ones, from the top. Boxes snap to them. */
  lines?: { x?: readonly number[]; y?: readonly number[] };
  /** The distance between the lines of a grid that boxes snap to; no grid when absent or 0. */
  grid?: number;
}

export interface SnapOptions {
  /** How near, in slide units, counts as lined up. Default 6. */
  threshold?: number;
  /** false switches snapping off, as when the person holds Alt. */
  enabled?: boolean;
  /** Snap along one axis only, as while a drag is locked to it. */
  axis?: Axis;
}

export interface SnapResult {
  /** How far to move the box further along x to land on the guides. */
  dx: number;
  dy: number;
  /** Where to draw them, worked out for the box once it has moved by dx and dy. */
  guides: Guide[];
}

export const DEFAULT_THRESHOLD = 6;

export const otherAxis = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
export const startOf = (r: Rect, axis: Axis): number => (axis === "x" ? r.x : r.y);
export const sizeOf = (r: Rect, axis: Axis): number => (axis === "x" ? r.w : r.h);
export const endOf = (r: Rect, axis: Axis): number => startOf(r, axis) + sizeOf(r, axis);

/** One way to line up along an axis: how far to move, and the guides to draw once the box has moved. */
export interface Candidate {
  offset: number;
  draw: (placed: Rect) => Guide[];
}

/** What a search along one axis settled on. */
export interface Solved {
  offset: number;
  picked: readonly Candidate[];
}

export const NOTHING: Solved = { offset: 0, picked: [] };

/** Tolerance for calling two positions the same, well under anything a person could see. */
const SAME = 1e-9;

/** The smallest move on offer; every candidate that needs that same move is kept, so all its guides show. */
export function nearest(candidates: readonly Candidate[]): Solved {
  let best: Candidate | undefined;
  for (const c of candidates) {
    if (!best || Math.abs(c.offset) < Math.abs(best.offset) - SAME) best = c;
  }
  if (!best) return NOTHING;
  const offset = best.offset;
  return { offset, picked: candidates.filter((c) => Math.abs(c.offset - offset) < SAME) };
}

/**
 * Joins guides on the same line into one that runs across all the boxes lined
 * up on it. Gap markers are only merged when they are the very same one.
 */
export function mergeGuides(guides: readonly Guide[]): Guide[] {
  const merged: Guide[] = [];
  for (const g of guides) {
    const twin = merged.find(
      (m) =>
        m.axis === g.axis &&
        m.kind === g.kind &&
        Math.abs(m.at - g.at) < SAME &&
        (g.kind !== "spacing" || (Math.abs(m.from - g.from) < SAME && Math.abs(m.to - g.to) < SAME)),
    );
    if (twin) {
      twin.from = Math.min(twin.from, g.from);
      twin.to = Math.max(twin.to, g.to);
    } else {
      merged.push({ ...g });
    }
  }
  return merged;
}
