// Draws only the rows of a long list that are on screen (and a few beyond),
// for rows of one fixed height inside the pane's scroller. The rest of the
// list is two blank spacers, so the scroll bar and the position stay true.

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Rows drawn above and below the ones on screen. */
const OVERSCAN = 6;
/** The height taken for the pane when it cannot be measured. */
const FALLBACK_VIEW = 800;

export interface Windowed {
  list: RefObject<HTMLUListElement | null>;
  /** The rows to draw: `start` up to, not including, `end`. */
  range: { start: number; end: number };
  /** Scrolls row `index` into view and draws it, ahead of the scroll event that would. */
  reveal(index: number): void;
  /** Blank space where the rows before and after the range would be, in pixels. */
  before: number;
  after: number;
}

const scrollerOf = (el: HTMLElement | null) => el?.closest<HTMLElement>("[data-scroll-root]") ?? null;

/** Where the list starts inside its scroller, in pixels. */
function offsetIn(el: HTMLElement, scroller: HTMLElement | null): number {
  if (!scroller) return 0;
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

export function useWindow(count: number, rowHeight: number, enabled: boolean): Windowed {
  const list = useRef<HTMLUListElement>(null);
  const visible = Math.ceil(FALLBACK_VIEW / rowHeight);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, visible + OVERSCAN) });
  const clamp = useCallback((start: number, end: number) => ({ start: Math.max(0, Math.min(start, count)), end: Math.max(0, Math.min(end, count)) }), [count]);

  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const scroller = scrollerOf(el);
    const height = scroller?.clientHeight || FALLBACK_VIEW;
    const first = Math.floor(((scroller?.scrollTop ?? 0) - offsetIn(el, scroller)) / rowHeight);
    const next = clamp(first - OVERSCAN, first + Math.ceil(height / rowHeight) + OVERSCAN);
    setRange((was) => (was.start === next.start && was.end === next.end ? was : next));
  }, [clamp, rowHeight]);

  useLayoutEffect(() => {
    if (!enabled) return;
    measure();
    const scroller = scrollerOf(list.current);
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      scroller?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [enabled, measure]);

  const reveal = useCallback(
    (index: number) => {
      const el = list.current;
      if (!el) return;
      const scroller = scrollerOf(el);
      if (scroller) {
        const top = offsetIn(el, scroller) + index * rowHeight;
        const height = scroller.clientHeight || FALLBACK_VIEW;
        if (top < scroller.scrollTop) scroller.scrollTop = top;
        else if (top + rowHeight > scroller.scrollTop + height) scroller.scrollTop = top + rowHeight - height;
      }
      const half = Math.ceil(visible / 2) + OVERSCAN;
      setRange(clamp(index - half, index + half));
    },
    [clamp, rowHeight, visible],
  );

  if (!enabled) return { list, range: { start: 0, end: count }, reveal, before: 0, after: 0 };
  const end = Math.min(range.end, count);
  const start = Math.min(range.start, end);
  return { list, range: { start, end }, reveal, before: start * rowHeight, after: (count - end) * rowHeight };
}
