// FLIP for lists: when rows are added, removed or reordered, the rest slide
// from where they were to where they are (First, Last, Invert, Play) rather
// than jump, and a new row fades in with a small rise. Rows opt in with
// `data-flip="<key>"`; the list's element is the ref. Only `translate` and
// `opacity` change, so layout is never animated, and nothing moves while
// motion is off.

import { useLayoutEffect, useRef, type RefObject } from "react";

/** How long a row takes to find its place (the base step). */
const FLIP_MS = 140;
/** Moves under this many pixels are not worth animating. */
const MIN_MOVE = 2;

type Spot = { x: number; y: number };

/** A list with more rows than this is left alone: measuring them all on every change would cost more than the motion is worth. */
export const FLIP_MAX_ROWS = 120;

/** Where each keyed row sits inside `list`, scroll included; null for a very long list. */
function spots(list: HTMLElement): Map<string, Spot> | null {
  const rows = list.querySelectorAll<HTMLElement>("[data-flip]");
  if (rows.length > FLIP_MAX_ROWS) return null;
  const base = list.getBoundingClientRect();
  const found = new Map<string, Spot>();
  for (const row of rows) {
    const at = row.getBoundingClientRect();
    found.set(row.dataset.flip!, { x: at.left - base.left + list.scrollLeft, y: at.top - base.top + list.scrollTop });
  }
  return found;
}

/** What slides, from how far: rows that were elsewhere, and rows that are new. */
export function flipMoves(before: Map<string, Spot>, after: Map<string, Spot>): { key: string; dx: number; dy: number; fresh: boolean }[] {
  const moves: { key: string; dx: number; dy: number; fresh: boolean }[] = [];
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) {
      moves.push({ key, dx: 0, dy: 0, fresh: true });
    } else if (Math.abs(was.x - now.x) >= MIN_MOVE || Math.abs(was.y - now.y) >= MIN_MOVE) {
      moves.push({ key, dx: was.x - now.x, dy: was.y - now.y, fresh: false });
    }
  }
  return moves;
}

/** Slides the rows of `list` into place whenever `order` changes (their keys
 * in order, or the array they come from). The first draw is not animated. */
export function useFlip(list: RefObject<HTMLElement | null>, order: unknown): void {
  const last = useRef<Map<string, Spot> | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    // Off, or before the setting is read, rows just take their place (and nothing is measured).
    if (document.documentElement.dataset.motion !== "on" || typeof el.animate !== "function") {
      last.current = null;
      return;
    }
    const now = spots(el);
    const before = last.current;
    last.current = now;
    if (!now || !before || before.size === 0) return;
    const rows = new Map<string, HTMLElement>();
    for (const row of el.querySelectorAll<HTMLElement>("[data-flip]")) rows.set(row.dataset.flip!, row);
    for (const move of flipMoves(before, now)) {
      const row = rows.get(move.key);
      if (!row) continue;
      const frames: Keyframe[] = move.fresh
        ? [{ opacity: 0, translate: "0 4px" }, { opacity: 1, translate: "0 0" }]
        : [{ translate: `${move.dx}px ${move.dy}px` }, { translate: "0 0" }];
      row.animate(frames, { duration: FLIP_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    }
  }, [list, order]);
}
