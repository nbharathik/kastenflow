// Snapping: nudging a dragged box onto the edges and centres of its neighbours
// and of the slide, and saying which lines it landed on.

import type { Rect } from "./geometry.ts";
import type { Axis, Candidate, Frame, GuideKind, SnapOptions, SnapResult, Solved } from "./guides.ts";
import { DEFAULT_THRESHOLD, NOTHING, endOf, mergeGuides, nearest, otherAxis, sizeOf, startOf } from "./guides.ts";
import { spacingCandidates } from "./spacing.ts";
import { handleDirection } from "./transform.ts";
import type { Handle } from "./transform.ts";

export type { Axis, Frame, Guide, GuideKind, SnapOptions, SnapResult } from "./guides.ts";

/** A place on the moving box that can line up with something. */
interface Mark {
  at: number;
  centre: boolean;
}

/** The start, middle and end of a box along an axis. */
function marksOf(box: Rect, axis: Axis): Mark[] {
  const start = startOf(box, axis);
  const size = sizeOf(box, axis);
  return [
    { at: start, centre: false },
    { at: start + size / 2, centre: true },
    { at: start + size, centre: false },
  ];
}

/** Every way for `marks` to land on an edge or centre of a target or of the slide, within `threshold`. */
function lineUps(marks: readonly Mark[], axis: Axis, targets: readonly Rect[], frame: Frame, threshold: number): Candidate[] {
  const across = otherAxis(axis);
  const length = axis === "x" ? frame.width : frame.height;
  const acrossLength = across === "x" ? frame.width : frame.height;
  const found: Candidate[] = [];

  // `beside` is the target the line belongs to; null for the slide, whose guides run its whole length.
  const offer = (mark: Mark, at: number, centre: boolean, kind: GuideKind | null, beside: Rect | null): void => {
    const offset = at - mark.at;
    if (Math.abs(offset) > threshold) return;
    const shown: GuideKind = kind ?? (mark.centre || centre ? "centre" : "edge");
    found.push({
      offset,
      draw: (placed) => {
        const from = beside ? Math.min(startOf(placed, across), startOf(beside, across)) : 0;
        const to = beside ? Math.max(endOf(placed, across), endOf(beside, across)) : acrossLength;
        return [{ axis, at, from, to, kind: shown }];
      },
    });
  };

  const slide: [at: number, centre: boolean, kind: GuideKind | null][] = [
    [0, false, null],
    [length / 2, true, null],
    [length, false, null],
  ];
  if (frame.margin && frame.margin > 0) slide.push([frame.margin, false, "margin"], [length - frame.margin, false, "margin"]);
  // The guides a person dragged out of the rulers run the slide's whole length, like its own edges.
  for (const at of (axis === "x" ? frame.lines?.x : frame.lines?.y) ?? []) slide.push([at, false, "guide"]);
  const grid = frame.grid && frame.grid > 0 ? frame.grid : 0;

  for (const mark of marks) {
    for (const [at, centre, kind] of slide) offer(mark, at, centre, kind, null);
    // A grid pulls without drawing a line: it is already on show, or nobody would have switched it on.
    if (grid) {
      const offset = Math.round(mark.at / grid) * grid - mark.at;
      if (Math.abs(offset) <= threshold) found.push({ offset, draw: () => [] });
    }
    for (const t of targets) {
      const start = startOf(t, axis);
      offer(mark, start, false, null, t);
      offer(mark, start + sizeOf(t, axis) / 2, true, null, t);
      offer(mark, endOf(t, axis), false, null, t);
    }
  }
  return found;
}

/**
 * How far to move a box that is being dragged, already at `moving`, so its
 * left, centre and right (and top, middle and bottom) land on those of the
 * `targets`, of the slide, or of the slide's margins, or so the gap to its
 * neighbours matches the gaps between them. The smallest move on each axis
 * within the threshold wins, and every line it then lands on is reported.
 */
export function snapMove(moving: Rect, targets: readonly Rect[], frame: Frame, opts: SnapOptions = {}): SnapResult {
  if (opts.enabled === false) return { dx: 0, dy: 0, guides: [] };
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const solve = (axis: Axis): Solved =>
    opts.axis && opts.axis !== axis
      ? NOTHING
      : nearest([...lineUps(marksOf(moving, axis), axis, targets, frame, threshold), ...spacingCandidates(moving, targets, axis, threshold)]);

  const x = solve("x");
  const y = solve("y");
  const placed: Rect = { x: moving.x + x.offset, y: moving.y + y.offset, w: moving.w, h: moving.h };
  return { dx: x.offset, dy: y.offset, guides: mergeGuides([...x.picked, ...y.picked].flatMap((c) => c.draw(placed))) };
}

/** `box` with the edges `handle` drags moved by `dx` and `dy`. */
function moveEdges(box: Rect, handle: Handle, dx: number, dy: number): Rect {
  const dir = handleDirection(handle);
  let { x, y, w, h } = box;
  if (dir.x > 0) w += dx;
  else if (dir.x < 0) [x, w] = [x + dx, w - dx];
  if (dir.y > 0) h += dy;
  else if (dir.y < 0) [y, h] = [y + dy, h - dy];
  return { x, y, w, h };
}

/**
 * The same for a box being resized: only the edges `handle` is dragging can
 * land on a line, and `dx` and `dy` are how far to move those edges. `box` is
 * the resized box, upright, and its size must be positive, so a box that has
 * been flipped past its opposite edge needs the handle `mirrorHandle` gives.
 * With `keepRatio` a corner can land on one line only; the other edge moves to
 * keep the proportions.
 */
export function snapResize(
  box: Rect,
  handle: Handle,
  targets: readonly Rect[],
  frame: Frame,
  opts: SnapOptions & { keepRatio?: boolean } = {},
): SnapResult {
  if (opts.enabled === false) return { dx: 0, dy: 0, guides: [] };
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const dir = handleDirection(handle);
  const solve = (axis: Axis): Solved => {
    const side = axis === "x" ? dir.x : dir.y;
    if (side === 0 || (opts.axis && opts.axis !== axis)) return NOTHING;
    const at = side > 0 ? endOf(box, axis) : startOf(box, axis);
    return nearest(lineUps([{ at, centre: false }], axis, targets, frame, threshold));
  };

  let x = solve("x");
  let y = solve("y");
  let dx = x.offset;
  let dy = y.offset;
  if (opts.keepRatio && dir.x !== 0 && dir.y !== 0 && box.w > 0 && box.h > 0) {
    // Both edges cannot land on lines and keep the ratio: go with the nearer line and let the other edge follow.
    const sign = dir.x * dir.y;
    if (x.picked.length > 0 && (y.picked.length === 0 || Math.abs(x.offset) <= Math.abs(y.offset))) {
      y = NOTHING;
      dy = (sign * x.offset * box.h) / box.w;
    } else if (y.picked.length > 0) {
      x = NOTHING;
      dx = (sign * y.offset * box.w) / box.h;
    }
  }

  const placed = moveEdges(box, handle, dx, dy);
  return { dx, dy, guides: mergeGuides([...x.picked, ...y.picked].flatMap((c) => c.draw(placed))) };
}
