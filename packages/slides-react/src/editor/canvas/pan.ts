// Moving the slide about in the window when it is bigger than the window: with the wheel (the stage scrolls by itself), and by
// dragging with the middle button or with Space held, as in every drawing program. The page under the pointer follows it.

import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useMemo, useRef } from "react";

/** What panning is doing, written on the stage so that the cursor can say it: ready (Space is down) or dragging. */
type Pan = "ready" | "drag";

export interface Panner {
  /** Space went down on the stage: the next press pans. True when the key was taken. */
  space(down: boolean): boolean;
  /** Whether a press is for panning rather than for the slide: the middle button, or Space held. */
  wants(event: { button: number }): boolean;
  /** Begins a pan at a press. */
  press(event: ReactPointerEvent<HTMLElement>): void;
  /** Follows the pointer; true while a pan is going on. */
  move(event: ReactPointerEvent<HTMLElement>): boolean;
  release(event: ReactPointerEvent<HTMLElement>): boolean;
}

export function usePan(stage: RefObject<HTMLElement | null>): Panner {
  const held = useRef(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const mark = useMemo(
    () =>
      (value: Pan | null): void => {
        const element = stage.current;
        if (!element) return;
        if (value) element.dataset.pan = value;
        else delete element.dataset.pan;
      },
    [stage],
  );
  // Space let go anywhere, or the window left, ends it: the key may come up where the stage cannot hear.
  useEffect(() => {
    const off = () => {
      held.current = false;
      if (!drag.current) mark(null);
    };
    const key = (event: KeyboardEvent) => event.code === "Space" && off();
    window.addEventListener("keyup", key);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", off);
    };
  }, [mark]);
  return useMemo<Panner>(
    () => ({
      space(down) {
        held.current = down;
        if (!drag.current) mark(down ? "ready" : null);
        return true;
      },
      wants: (event) => event.button === 1 || (event.button === 0 && held.current),
      press(event) {
        const element = stage.current;
        if (!element) return;
        drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        mark("drag");
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          // The pointer is followed by the stage's own events without it.
        }
        event.preventDefault();
      },
      move(event) {
        const start = drag.current;
        const element = stage.current;
        if (!start || !element) return false;
        element.scrollLeft = start.left - (event.clientX - start.x);
        element.scrollTop = start.top - (event.clientY - start.y);
        return true;
      },
      release(event) {
        if (!drag.current) return false;
        drag.current = null;
        mark(held.current ? "ready" : null);
        try {
          stage.current?.releasePointerCapture(event.pointerId);
        } catch {
          // Nothing was held.
        }
        return true;
      },
    }),
    [stage, mark],
  );
}
