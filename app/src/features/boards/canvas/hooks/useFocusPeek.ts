// In focus mode the bars are hidden; this brings them back for a moment while
// the pointer is within a few pixels of an edge of the board, or after a key on
// the board (not one typed into a card or a field, which keeps writing quiet).
// It stays while the pointer rests on a bar or a panel is open. The board's
// `data-peek` says so, and the CSS (chrome.css) does the showing, so nothing
// redraws.

import { useEffect, type RefObject } from "react";

import { editable } from "./useBoardKeys";

/** How close to an edge the pointer wakes the bars, in pixels. */
const EDGE = 56;
/** How long they stay after the pointer leaves the edge, or after a key. */
const LINGER_MS = 700;
const AFTER_KEY_MS = 2200;

const IN_USE = ".kasten-chrome:hover, .kasten-chrome:focus-within, .kasten-pop";

export function useFocusPeek(wrapper: RefObject<HTMLDivElement | null>, focus: boolean): void {
  useEffect(() => {
    const el = wrapper.current;
    if (!el || !focus) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (ms: number) => {
      el.dataset.peek = "true";
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Still on a bar, or a panel from one is open: keep them.
        if (el.querySelector(IN_USE)) show(LINGER_MS);
        else delete el.dataset.peek;
      }, ms);
    };
    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const near = event.clientX - box.left < EDGE || box.right - event.clientX < EDGE || event.clientY - box.top < EDGE || box.bottom - event.clientY < EDGE;
      if (near) show(LINGER_MS);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "\\" && !editable(event.target)) show(AFTER_KEY_MS);
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("keydown", onKey);
      clearTimeout(timer);
      delete el.dataset.peek;
    };
  }, [wrapper, focus]);
}
