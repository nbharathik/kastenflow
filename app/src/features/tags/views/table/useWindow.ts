// Row windowing: only the rows in view (and a few either side) are drawn,
// so a tag with thousands of notes scrolls as lightly as one with ten. The
// span changes once per row scrolled, not per pixel.

import { useLayoutEffect, useState, type RefObject } from "react";

import { HEAD_HEIGHT, ROW_HEIGHT } from "./context";
import { windowOf, type Span } from "./grid";

const OVERSCAN = 8;

const same = (a: Span, b: Span) => a.start === b.start && a.end === b.end;

/** Where each table was scrolled to, so coming back to a tab finds its place. */
const scrolls = new Map<string, { top: number; left: number }>();
const MAX_SCROLLS = 50;

/** Keeps `scroller`'s place under `key` and puts it back on mount. Call it
 * before useWindow, which then draws the rows at the place put back. */
export function useScrollMemory(scroller: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const saved = scrolls.get(key);
    if (saved) {
      el.scrollTop = saved.top;
      el.scrollLeft = saved.left;
    }
    const keep = () => {
      scrolls.delete(key);
      scrolls.set(key, { top: el.scrollTop, left: el.scrollLeft });
      if (scrolls.size > MAX_SCROLLS) scrolls.delete(scrolls.keys().next().value!);
    };
    el.addEventListener("scroll", keep, { passive: true });
    return () => el.removeEventListener("scroll", keep);
  }, [scroller, key]);
}

/** Marks the scroller once it is scrolled across or down, for the sticky
 * title's and header's shadows; set on the element, so nothing redraws. */
export function useScrollEdges(scroller: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mark = () => {
      el.toggleAttribute("data-scrolled-x", el.scrollLeft > 0);
      el.toggleAttribute("data-scrolled-y", el.scrollTop > 0);
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    return () => el.removeEventListener("scroll", mark);
  }, [scroller]);
}

/** The rows to draw in `scroller`, which holds the sticky header and then the rows. */
export function useWindow(scroller: RefObject<HTMLElement | null>, count: number, rowHeight: number = ROW_HEIGHT): Span {
  const [span, setSpan] = useState(() => windowOf(0, 0, rowHeight, count, OVERSCAN));
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      const next = windowOf(el.scrollTop, el.clientHeight - HEAD_HEIGHT, rowHeight, count, OVERSCAN);
      setSpan((current) => (same(current, next) ? current : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scroller, count, rowHeight]);
  return span;
}
