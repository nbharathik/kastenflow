// The gaps between the selection and another block, shown while Alt is held over that block: how far it is from each side that faces it.
// Pure geometry on the outlines of the two; the labels are drawn by DistanceLabels.

import type { Rect } from "@kasten-slides/canvas";

/**
 * One gap. `axis: "x"` is a horizontal gap: a line along x from `from` to `to`, at height `at`; `axis: "y"` runs along y, at the
 * distance `at` from the left. `size` is how long it is, in slide units.
 */
export interface Gap {
  axis: "x" | "y";
  from: number;
  to: number;
  at: number;
  size: number;
}

/** A gap shorter than this is not shown: the two touch. */
const LEAST = 0.5;

const right = (r: Rect): number => r.x + r.w;
const bottom = (r: Rect): number => r.y + r.h;
const middle = (low: number, high: number): number => (low + high) / 2;

const gap = (axis: Gap["axis"], from: number, to: number, at: number): Gap[] => (to - from >= LEAST ? [{ axis, from, to, at, size: to - from }] : []);

/** Whether `inner` lies inside `outer`, edges touching included. */
const holds = (outer: Rect, inner: Rect): boolean => inner.x >= outer.x && right(inner) <= right(outer) && inner.y >= outer.y && bottom(inner) <= bottom(outer);

/**
 * The gaps between two outlines. Side by side, the gap between the sides that face each other, drawn where the two overlap in the other
 * direction (else along the middle of `a`); a corner to corner pair has one each way. One inside the other, how far each of its four sides
 * is from the outer one. Outlines that overlap without either holding the other have no gap.
 */
export function gapsBetween(a: Rect, b: Rect): Gap[] {
  const apart = right(a) <= b.x || right(b) <= a.x || bottom(a) <= b.y || bottom(b) <= a.y;
  if (!apart) {
    const [outer, inner] = holds(a, b) ? [a, b] : holds(b, a) ? [b, a] : [null, null];
    if (!outer || !inner) return [];
    const midX = middle(inner.x, right(inner));
    const midY = middle(inner.y, bottom(inner));
    return [...gap("x", outer.x, inner.x, midY), ...gap("x", right(inner), right(outer), midY), ...gap("y", outer.y, inner.y, midX), ...gap("y", bottom(inner), bottom(outer), midX)];
  }
  const gaps: Gap[] = [];
  const overlapY = [Math.max(a.y, b.y), Math.min(bottom(a), bottom(b))] as const;
  const overlapX = [Math.max(a.x, b.x), Math.min(right(a), right(b))] as const;
  if (right(a) <= b.x || right(b) <= a.x) {
    const [near, far] = right(a) <= b.x ? [a, b] : [b, a];
    gaps.push(...gap("x", right(near), far.x, overlapY[0] < overlapY[1] ? middle(...overlapY) : middle(a.y, bottom(a))));
  }
  if (bottom(a) <= b.y || bottom(b) <= a.y) {
    const [near, far] = bottom(a) <= b.y ? [a, b] : [b, a];
    gaps.push(...gap("y", bottom(near), far.y, overlapX[0] < overlapX[1] ? middle(...overlapX) : middle(a.x, right(a))));
  }
  return gaps;
}
