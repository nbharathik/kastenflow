// Where a box goes when it is added by a key: at the pointer, snapped as a drag
// would be and held inside the slide, or, when the pointer is not over the
// slide, at the nearest place with room to the top left third of it.

import { type Rect, clamp, intersects, snapMove } from "@kasten-slides/canvas";

type Size = { w: number; h: number };

/** How near, in screen pixels, a box put at the pointer snaps to a line: as near as a drag's. */
export const SNAP = 6;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A box of `size` with its top left at the pointer `at`, whole units, then snapped to the edges and middles of `targets`
 * and of the slide when `threshold` says how near (slide units; null for no snapping), and held inside the slide.
 */
export function spotAt(at: { x: number; y: number }, size: Size, slide: Size, targets: readonly Rect[], threshold: number | null): Rect {
  const inside = (n: number, room: number): number => clamp(n, 0, Math.max(0, room));
  let x = inside(Math.round(at.x), slide.w - size.w);
  let y = inside(Math.round(at.y), slide.h - size.h);
  if (threshold !== null) {
    const snap = snapMove({ x, y, ...size }, targets, { width: slide.w, height: slide.h, margin: 0 }, { threshold });
    x = inside(x + snap.dx, slide.w - size.w);
    y = inside(y + snap.dy, slide.h - size.h);
  }
  return { x: round2(x), y: round2(y), ...size };
}

/** How far apart the places tried are, how far from the edge of the slide they stay, and how much room is left round what is there. */
const STEP = 24;
const MARGIN = 24;
const AIR = 8;
/** How far a box is moved from the one before it when there is no room at all, so that it does not hide exactly behind it. */
const CASCADE = 24;

const inflate = (box: Rect, by: number): Rect => ({ x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by });

/**
 * Where a box of `size` goes on a slide with `obstacles` on it, when nothing says where: a tenth of the slide in and a sixth
 * down, near the top left third of it, if that is free; else the nearest place to it (in steps of 24) that is; else, on a
 * slide with no room, there, moved a little from any box that starts at the same place.
 */
export function freeSpot(size: Size, obstacles: readonly Rect[], slide: Size): Rect {
  const anchor = { x: Math.round(slide.w / 10), y: Math.round(slide.h / 6) };
  const at = (x: number, y: number): Rect => ({ x, y, ...size });
  const clear = (box: Rect): boolean => !obstacles.some((obstacle) => intersects(box, inflate(obstacle, AIR)));
  const fits = (x: number, y: number): boolean => x >= 0 && y >= 0 && x + size.w <= slide.w && y + size.h <= slide.h;
  if (fits(anchor.x, anchor.y) && clear(at(anchor.x, anchor.y))) return at(anchor.x, anchor.y);

  let best: { x: number; y: number; distance: number } | null = null;
  for (let y = MARGIN; y + size.h + MARGIN <= slide.h; y += STEP) {
    for (let x = MARGIN; x + size.w + MARGIN <= slide.w; x += STEP) {
      const distance = Math.hypot(x - anchor.x, y - anchor.y);
      if ((!best || distance < best.distance) && clear(at(x, y))) best = { x, y, distance };
    }
  }
  if (best) return at(best.x, best.y);

  // No room: over the others, a little apart from any that start where this one would.
  let x = clamp(anchor.x, 0, Math.max(0, slide.w - size.w));
  let y = clamp(anchor.y, 0, Math.max(0, slide.h - size.h));
  for (let step = 0; step < 8 && obstacles.some((o) => Math.abs(o.x - x) < 6 && Math.abs(o.y - y) < 6) && x + CASCADE + size.w <= slide.w && y + CASCADE + size.h <= slide.h; step++) {
    x += CASCADE;
    y += CASCADE;
  }
  return at(x, y);
}
