// The rows of the filmstrip move to their new places instead of jumping there (a slide dragged to another
// place, a slide put back by undo, a section folded), and a slide that is new slides in. This is the FLIP
// way: the layout already says where every row was and is, so no measuring is needed; each row that moved
// is drawn where it was and let go to where it is. Nothing moves while the host's motion setting is off.

import { type MutableRefObject, type RefObject, useLayoutEffect, useRef } from "react";

import { EASE, moveMs, motionOn, play } from "../motion.ts";
import type { FilmLayout, Shifts } from "./model.ts";
import type { Drop } from "./reorder.ts";

/** The easing of Kasten's motion tokens. */
const EASING = EASE;
/** The most rows one change moves at once: a slide put in at the top of a long deck shifts them all, and only the ones in view are worth drawing. */
const MOST_ANIMATED = 40;
/** How far past the window a row still moves, in pixels. */
const AHEAD = 160;
/** How far above its place a new slide starts. */
const DROP_IN = 12;

/** The top of every slide row in the layout, by slide id. */
export function topsOf(layout: FilmLayout): Map<string, number> {
  const tops = new Map<string, number>();
  for (const entry of layout.entries) if (entry.kind === "slide") tops.set(entry.id, entry.top);
  return tops;
}

/** What each row does for a change of layout: `moved` is how far above its new place it was, `added` slides in; rows that did not move are left out. */
export function planMotion(previous: ReadonlyMap<string, number>, next: ReadonlyMap<string, number>): { moved: Map<string, number>; added: string[] } {
  const moved = new Map<string, number>();
  const added: string[] = [];
  for (const [id, top] of next) {
    const was = previous.get(id);
    if (was === undefined) added.push(id);
    else if (was !== top) moved.set(id, was - top);
  }
  return { moved, added };
}

/**
 * Moves the rows of `list` as the layout changes. `scroller` is what scrolls the list, so that only the rows in view (and a little
 * beyond) move.
 */
export function useRowMotion(list: RefObject<HTMLElement | null>, scroller: RefObject<HTMLElement | null>, layout: FilmLayout, landing?: MutableRefObject<Drop | null>): void {
  const before = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const now = topsOf(layout);
    const previous = before.current;
    before.current = now;
    const root = list.current;
    // The first drawing, and a deck that had no rows to come from, set nothing moving.
    if (!previous || previous.size === 0 || !root || !motionOn()) return;
    // Slides that were dragged here have already been shown going: the rows made room as they came (see `useLanding`).
    if (landing?.current?.moved) return;
    const { moved, added } = planMotion(previous, now);
    if (moved.size === 0 && added.length === 0) return;
    const area = scroller.current;
    const from = (area?.scrollTop ?? 0) - AHEAD;
    const to = from + (area?.clientHeight || Number.POSITIVE_INFINITY) + 2 * AHEAD;
    const seen = (top: number | undefined) => top !== undefined && top >= from && top <= to;
    const duration = moveMs(root);
    // The host's token is nothing: rows go where they are at once.
    if (duration <= 0) return;
    let count = 0;
    const row = (id: string) => root.querySelector<HTMLElement>(`[data-slide="${id}"]`);
    for (const [id, delta] of moved) {
      if (count >= MOST_ANIMATED) break;
      const top = now.get(id);
      if (!seen(top) && !seen(previous.get(id))) continue;
      const node = row(id);
      if (node && play(node, [{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration, easing: EASING })) count += 1;
    }
    for (const id of added) {
      if (count >= MOST_ANIMATED) break;
      if (!seen(now.get(id))) continue;
      const node = row(id);
      if (node && play(node, [{ opacity: 0, transform: `translateY(${-DROP_IN}px)` }, { opacity: 1, transform: "none" }], { duration, easing: EASING })) count += 1;
    }
  }, [layout, list, scroller]);
}

/**
 * Puts the rows where slides in the hand have them: each row that makes room is moved by what `gapShifts` says (the stylesheet
 * makes it glide), and every row is put back when there is nothing in the hand or it is over nothing.
 */
export function useGapShifts(list: RefObject<HTMLElement | null>, shifts: Shifts | null): void {
  const moved = useRef<Set<HTMLElement>>(new Set());
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const now = new Set<HTMLElement>();
    const put = (node: HTMLElement, by: number | undefined) => {
      node.style.transform = by ? `translateY(${by}px)` : "";
      if (by) now.add(node);
    };
    if (shifts) {
      for (const row of root.querySelectorAll<HTMLElement>(".ks-fs-row[data-slide]")) put(row, shifts.rows.get(row.dataset.slide ?? ""));
      for (const head of root.querySelectorAll<HTMLElement>(".ks-fs-section[data-section]")) put(head, shifts.headers.get(head.dataset.section ?? ""));
    }
    for (const node of moved.current) if (!now.has(node)) node.style.transform = "";
    moved.current = now;
  }, [shifts, list]);
}

/**
 * Lands the slides that were in the hand: each comes from where it was held to its row, and, when the order changed, the rows
 * do not glide again (they made room as the slides came, and are where they will be). A drop that goes home, or is called off,
 * lets the rows slide back and the slides settle into their places.
 */
export function useLanding(list: RefObject<HTMLElement | null>, landing: MutableRefObject<Drop | null>, dragging: boolean): void {
  useLayoutEffect(() => {
    if (dragging) return;
    const drop = landing.current;
    landing.current = null;
    const root = list.current;
    if (!drop || !root) return;
    if (drop.moved) {
      // The rows are already where they will be: take their shifts away without a glide, and let them glide again after.
      root.dataset.still = "";
      requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.still));
    }
    const duration = moveMs(root);
    if (!motionOn() || duration <= 0) return;
    for (const id of drop.ids) {
      const row = root.querySelector<HTMLElement>(`.ks-fs-row[data-slide="${id}"]`);
      const box = row?.querySelector<HTMLElement>(".ks-fs-frame")?.getBoundingClientRect();
      if (!row || !box) continue;
      const dx = drop.from.x - box.left;
      const dy = drop.from.y - box.top;
      if (Math.hypot(dx, dy) < 2) continue;
      play(row, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration, easing: EASING });
    }
  }, [dragging, landing, list]);
}

/**
 * A row that is going for good (a slide that was deleted) is left behind for a moment, fading and folding away, while the rows
 * below it come up. `node` is the row about to be taken out of the page; this puts a copy of it where it was, and removes the
 * copy when it is done.
 */
export function leaveRow(node: HTMLElement): void {
  const parent = node.parentElement;
  const duration = moveMs(node);
  if (!parent || !parent.isConnected || !motionOn() || duration <= 0 || typeof node.animate !== "function") return;
  const copy = node.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  copy.removeAttribute("data-slide");
  copy.setAttribute("aria-hidden", "true");
  copy.removeAttribute("role");
  Object.assign(copy.style, { position: "absolute", left: "0", right: "0", top: `${node.offsetTop}px`, height: `${node.offsetHeight}px`, pointerEvents: "none", transform: "" });
  parent.append(copy);
  const done = play(copy, [{ opacity: 1, scale: "1" }, { opacity: 0, scale: "0.94" }], { duration, easing: EASING });
  if (done) void done.finished.then(() => copy.remove(), () => copy.remove());
  else copy.remove();
}
