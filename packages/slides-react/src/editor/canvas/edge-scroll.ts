// A drag that reaches the edge of the window carries the stage with it, when there is slide beyond the edge: the nearer the
// pointer is to the edge, the faster it goes. Each step puts the pointer, which has not moved, on the slide again.

import { type RefObject, useEffect, useMemo, useRef } from "react";

/** How near an edge the pointer must be to start scrolling, in pixels. */
export const EDGE = 36;
/** The most pixels a frame scrolls. */
export const MOST = 18;

/** How far to scroll along one axis for a pointer at `at` between `low` and `high`: negative towards the start, zero in the middle. */
export function speedAt(at: number, low: number, high: number): number {
  const near = (distance: number) => Math.min(MOST, Math.max(1, Math.round(((EDGE - distance) / EDGE) * MOST)));
  if (at < low + EDGE) return -near(Math.max(at - low, 0));
  if (at > high - EDGE) return near(Math.max(high - at, 0));
  return 0;
}

export interface EdgeScroll {
  /** The pointer is at this place in the window; starts scrolling when it is by an edge. */
  follow(clientX: number, clientY: number): void;
  stop(): void;
}

/**
 * `busy` says whether a gesture is still going on, and `then` is told, after each scroll, where the pointer is, so the gesture
 * can take it as a move.
 */
export function useEdgeScroll(stage: RefObject<HTMLElement | null>, busy: () => boolean, then: (clientX: number, clientY: number) => void): EdgeScroll {
  const where = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  const latest = useRef({ busy, then });
  latest.current = { busy, then };
  const api = useMemo<EdgeScroll>(() => {
    const tick = (): void => {
      frame.current = null;
      const element = stage.current;
      if (!element || !latest.current.busy()) return;
      const box = element.getBoundingClientRect();
      const dx = element.scrollWidth > element.clientWidth ? speedAt(where.current.x, box.left, box.right) : 0;
      const dy = element.scrollHeight > element.clientHeight ? speedAt(where.current.y, box.top, box.bottom) : 0;
      if (dx === 0 && dy === 0) return;
      const left = element.scrollLeft;
      const top = element.scrollTop;
      element.scrollLeft += dx;
      element.scrollTop += dy;
      // At the end of the slide there is nothing more to take: stop until the pointer moves again.
      if (element.scrollLeft === left && element.scrollTop === top) return;
      latest.current.then(where.current.x, where.current.y);
      frame.current = requestAnimationFrame(tick);
    };
    return {
      follow(clientX, clientY) {
        where.current = { x: clientX, y: clientY };
        frame.current ??= requestAnimationFrame(tick);
      },
      stop() {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
      },
    };
  }, [stage]);
  useEffect(() => api.stop, [api]);
  return api;
}
