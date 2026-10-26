// A view fades in as a pane moves to it, so the change reads as one step
// rather than a flash. The first view of a pane shows at once, a tab shown
// again after being kept ready shows at once (it was never gone), typing
// never triggers it, and it takes no time while motion is off.

import { useLayoutEffect, useRef, type RefObject } from "react";

import { motionMs } from "../lib/motion";

/** How long the fade takes, in milliseconds. */
export const VIEW_FADE_MS = 120;

/** Fades `element` in when `place` changes. `fadeOnMount` also fades a view mounted after the pane was already showing something (a newly opened tab). */
export function useViewEnter(element: RefObject<HTMLElement | null>, place: string, fadeOnMount = false): void {
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    const first = last.current === null;
    // Shown again after being hidden, with nothing new in it.
    if (last.current === place) return;
    last.current = place;
    if (first && !fadeOnMount) return;
    const el = element.current;
    const ms = motionMs(VIEW_FADE_MS);
    if (!el || ms === 0 || typeof el.animate !== "function") return;
    const fade = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    return () => fade.cancel();
    // fadeOnMount only matters at the first run.
  }, [element, place]);
}
