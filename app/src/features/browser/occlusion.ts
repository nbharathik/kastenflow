// A native web view is drawn above everything the window draws, so anything
// that opens over it (a menu, a dialog, the palette, a peek, a drag) would be
// hidden behind the page. Overlays say so here; while any of them overlaps the
// browser's area, the view is hidden and its placeholder shows the page's
// title instead. An overlay that cannot say where it is covers the window.

import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";
import { create } from "zustand";

import { boxOf, isEmpty, overlaps, type Box } from "./bounds";

/** What an overlay covers: a rectangle, or the whole window. */
export type Hold = Box | "all";

interface Occlusion {
  holds: Readonly<Record<string, Hold>>;
  /** The areas native views are shown over now, by tab. */
  areas: Readonly<Record<string, Box>>;
  hold(key: string, area: Hold): void;
  release(key: string): void;
  /** A browser tab's view is shown over `box`, or (with none) no more. */
  show(key: string, box: Box | null): void;
}

export const useOcclusion = create<Occlusion>()((set) => ({
  holds: {},
  areas: {},
  show: (key, box) =>
    set((s) => {
      if (box === null) {
        if (!(key in s.areas)) return s;
        const { [key]: _gone, ...rest } = s.areas;
        return { areas: rest };
      }
      const known = s.areas[key];
      if (known && known.left === box.left && known.top === box.top && known.right === box.right && known.bottom === box.bottom) return s;
      return { areas: { ...s.areas, [key]: box } };
    }),
  hold: (key, area) =>
    set((s) => {
      const known = s.holds[key];
      const same = known === area || (known && area !== "all" && known !== "all" && known.left === area.left && known.top === area.top && known.right === area.right && known.bottom === area.bottom);
      return same ? s : { holds: { ...s.holds, [key]: area } };
    }),
  release: (key) =>
    set((s) => {
      if (!(key in s.holds)) return s;
      const { [key]: _gone, ...rest } = s.holds;
      return { holds: rest };
    }),
}));

/** Whether any hold covers `area`. A hold named in `ignoring` is not counted (the view of a show is above the show's own hold). */
export const covered = (holds: Readonly<Record<string, Hold>>, area: Box, ignoring?: string): boolean =>
  Object.entries(holds).some(([key, hold]) => key !== ignoring && (hold === "all" || overlaps(hold, area)));

/** An overlay is open while the component is mounted (or `on`): it covers
 * the rectangle `measure` gives, read after each layout and when the window
 * resizes or scrolls, else the whole window. One line in each overlay. */
export function useOccludes(on = true, measure?: () => Box | null): void {
  const key = useId();
  const latest = useRef(measure);
  useLayoutEffect(() => {
    latest.current = measure;
  });
  useLayoutEffect(() => {
    if (!on) return;
    const place = () => useOcclusion.getState().hold(key, latest.current?.() ?? "all");
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      useOcclusion.getState().release(key);
    };
  }, [on, key]);
  // The rectangle is read again after every render of the overlay, since its place may have settled.
  useEffect(() => {
    if (on && latest.current) useOcclusion.getState().hold(key, latest.current() ?? "all");
  });
}

let elements = 0;

/** A popup that is a plain element of the page (a menu a text editor builds, not a
 * component) covers the area it takes for as long as it is on the page. The
 * rectangle is read now, and again whenever the element's size or style changes
 * (the editor moves a menu by its style) or the window resizes or scrolls; an element
 * that is gone or has no area covers nothing. Returns how to let go. */
export function occludeElement(element: Element): () => void {
  const key = `element:${++elements}`;
  const place = () => {
    const box = element.isConnected ? boxOf(element.getBoundingClientRect()) : null;
    if (box && !isEmpty(box)) useOcclusion.getState().hold(key, box);
    else useOcclusion.getState().release(key);
  };
  place();
  const stops: (() => void)[] = [];
  if (typeof ResizeObserver !== "undefined") {
    const resized = new ResizeObserver(place);
    resized.observe(element);
    stops.push(() => resized.disconnect());
  }
  if (typeof MutationObserver !== "undefined") {
    const moved = new MutationObserver(place);
    moved.observe(element, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
    stops.push(() => moved.disconnect());
  }
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
  return () => {
    stops.forEach((stop) => stop());
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
    useOcclusion.getState().release(key);
  };
}

/** The same for a component's own element: it covers its area while it is shown (`on`). */
export function useOccludesElement(element: RefObject<Element | null>, on = true): void {
  useLayoutEffect(() => {
    const target = element.current;
    if (!on || !target) return;
    return occludeElement(target);
  }, [element, on]);
}

/** A gesture holds the window while it lasts (a tab or a pane being dragged,
 * over views that would swallow the pointer); it ends at the next drop, drag
 * end or pointer release, whatever else happens. */
export function holdWhile(key: string): void {
  useOcclusion.getState().hold(`gesture:${key}`, "all");
  const end = () => {
    useOcclusion.getState().release(`gesture:${key}`);
    for (const name of ENDS) document.removeEventListener(name, end, true);
    window.removeEventListener("blur", end);
  };
  for (const name of ENDS) document.addEventListener(name, end, true);
  window.addEventListener("blur", end);
}

const ENDS = ["dragend", "drop", "pointerup", "pointercancel"] as const;
