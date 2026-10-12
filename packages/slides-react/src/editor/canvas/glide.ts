// Things that come to rest instead of jumping: after an undo, a redo, an align or a turn by a quarter, each element that moved
// glides from where it was to where it is (a drag needs none: it has shown the element where it lands), and moving to another
// slide fades the new one in. Everything is drawn with the browser's own animations, which cost the page nothing per step.

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import { EASE, fastMs, moveMs, motionOn, play } from "../motion.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorState } from "../session/types.ts";
import { itemsOf } from "./geometry.ts";

/** Where an element is, as the glide reads it. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** What an element is drawn with to look as it did: from where it was, which is its box now with this applied. */
export interface Offset {
  /** Slide units. */
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** Degrees, the short way round. */
  turn: number;
}

/** The turn from `to` back to `from`, the short way, in [-180, 180]. */
export function shortTurn(from: number, to: number): number {
  const d = (((from - to) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** How far an element is from where it was, or null when it is near enough that nothing need glide. */
export function offsetOf(was: Spot, now: Spot): Offset | null {
  const dx = was.x + was.w / 2 - (now.x + now.w / 2);
  const dy = was.y + was.h / 2 - (now.y + now.h / 2);
  const sx = now.w > 1e-6 ? was.w / now.w : 1;
  const sy = now.h > 1e-6 ? was.h / now.h : 1;
  const turn = shortTurn(was.rotation, now.rotation);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005 && Math.abs(turn) < 0.5) return null;
  return { dx, dy, sx, sy, turn };
}

/** The most elements that glide at once; the rest of a large change just land. */
const MOST = 40;

const spotsOf = (session: EditorSession): Map<string, Spot> => new Map(itemsOf(session).map((item) => [item.id, { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation ?? 0 }]));

/** Plays the glides for every element that is somewhere else than it was. Answers how many were started. */
export function glideElements(root: HTMLElement, page: HTMLElement | null, was: ReadonlyMap<string, Spot>, now: ReadonlyMap<string, Spot>, zoom: number): number {
  let count = 0;
  for (const [id, spot] of now) {
    if (count >= MOST) break;
    const before = was.get(id);
    const offset = before ? offsetOf(before, spot) : null;
    if (!offset) continue;
    const node = root.querySelector<HTMLElement>(`[data-el="${id.replaceAll('"', '\\"')}"]`);
    if (!node) continue;
    const from = { translate: `${offset.dx}px ${offset.dy}px`, rotate: `${offset.turn}deg`, scale: `${offset.sx} ${offset.sy}` };
    const to = { translate: "0 0", rotate: "0deg", scale: "1 1" };
    if (play(node, [from, to], { duration: moveMs(node), easing: EASE })) count += 1;
    // The frame and handles round it go with it.
    const frame = page?.querySelector<HTMLElement>(`.ks-overlay [data-frame="${id.replaceAll('"', '\\"')}"]`);
    if (frame) play(frame, [{ translate: `${offset.dx * zoom}px ${offset.dy * zoom}px` }, { translate: "0 0" }], { duration: moveMs(frame), easing: EASE });
  }
  return count;
}

interface Options {
  session: EditorSession;
  state: EditorState;
  /** The slide drawn at its own size (what the elements are in) and the page round it and the overlay. */
  scaled: RefObject<HTMLElement | null>;
  page: RefObject<HTMLElement | null>;
  zoom: number;
}

export function useGlide({ session, state, scaled, page, zoom }: Options): void {
  const before = useRef<{ slideId: string; revision: number; spots: Map<string, Spot> } | null>(null);
  // After a change that puts elements elsewhere, they come from where they were. A drag is not one: the page already showed it.
  useLayoutEffect(() => {
    const root = scaled.current;
    const spots = spotsOf(session);
    const was = before.current;
    before.current = { slideId: state.slideId, revision: state.revision, spots };
    if (!root || !was || was.slideId !== state.slideId || was.revision === state.revision || state.settle === null) return;
    glideElements(root, page.current, was.spots, spots, zoom);
  }, [state.revision, state.slideId]);

  // Another slide takes the place of the one before, which fades away over it: the slide on the page when the session says
  // another is wanted is still the old one (the page is drawn after the session changes), so it is copied then.
  const shown = useRef(state.slideId);
  const leaving = useRef<HTMLElement | null>(null);
  useEffect(
    () =>
      session.subscribe(() => {
        const root = scaled.current;
        const host = page.current;
        if (!root || !host || session.state.slideId === shown.current || typeof root.animate !== "function") return;
        if (!motionOn()) return;
        leaving.current?.remove();
        const copy = root.cloneNode(true) as HTMLElement;
        copy.setAttribute("aria-hidden", "true");
        copy.dataset.leaving = "";
        copy.style.pointerEvents = "none";
        root.after(copy);
        leaving.current = copy;
        const fade = play(copy, [{ opacity: 1 }, { opacity: 0 }], { duration: fastMs(root), easing: EASE });
        const done = () => {
          copy.remove();
          if (leaving.current === copy) leaving.current = null;
        };
        if (fade) void fade.finished.then(done, done);
        else done();
      }),
    [session, scaled, page],
  );
  useLayoutEffect(() => {
    shown.current = state.slideId;
  }, [state.slideId]);
  useEffect(() => () => leaving.current?.remove(), []);
}
