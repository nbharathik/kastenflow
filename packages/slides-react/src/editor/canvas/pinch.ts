// Two fingers on the stage zoom the slide about the place between them, and carry it with them: the same continuous zoom as a
// wheel with Ctrl, driven by the fingers. The first finger may already have begun something (a move, a selection rectangle); the
// second takes that back.

import { type PointerEvent as ReactPointerEvent, useMemo, useRef } from "react";

import type { EditorUi } from "../ui-state.ts";

interface Fingers {
  /** How far apart the two are, in pixels, and the place half way between them in the window. */
  distance: number;
  centre: { x: number; y: number };
}

/** The measure of two fingers. */
export function measure(a: { x: number; y: number }, b: { x: number; y: number }): Fingers {
  return { distance: Math.hypot(b.x - a.x, b.y - a.y), centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

export interface Pinch {
  /** Two fingers are down: the gestures of the slide leave the pointer alone. */
  readonly active: boolean;
  /** A touch went down; answers whether it is now a pinch. */
  down(event: ReactPointerEvent): boolean;
  /** A touch moved; answers whether it is part of a pinch. */
  move(event: ReactPointerEvent): boolean;
  /** A touch went up or was taken away. */
  up(event: ReactPointerEvent): void;
}

/** `begin` is told when the second finger comes down, so that what the first started can be called off. */
export function usePinch(ui: EditorUi, begin: () => void): Pinch {
  const points = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<Fingers | null>(null);
  const latest = useRef(begin);
  latest.current = begin;
  return useMemo<Pinch>(() => {
    const two = (): Fingers | null => {
      if (points.current.size !== 2) return null;
      const [a, b] = [...points.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      return measure(a, b);
    };
    return {
      get active() {
        return last.current !== null;
      },
      down(event) {
        if (event.pointerType !== "touch") return false;
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const now = two();
        if (now) {
          last.current = now;
          latest.current();
        }
        return last.current !== null;
      },
      move(event) {
        if (event.pointerType !== "touch" || !points.current.has(event.pointerId)) return last.current !== null;
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const before = last.current;
        const now = two();
        if (!before || !now || before.distance <= 0) return before !== null;
        // The place of the slide that was between the fingers stays between them, wherever they have gone: zoomed, and carried along.
        if (now.distance > 0) ui.zoomBy(now.distance / before.distance, before.centre, now.centre);
        last.current = now;
        return true;
      },
      up(event) {
        points.current.delete(event.pointerId);
        if (points.current.size < 2) last.current = null;
      },
    };
  }, [ui]);
}
