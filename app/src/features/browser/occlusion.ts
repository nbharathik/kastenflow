// A native web view is drawn above everything the window draws, so anything
// that opens over it (a menu, a dialog, the palette, a peek, a drag) would be
// hidden behind the page. Overlays say so here; while any of them overlaps the
// browser's area, the view is hidden and its placeholder shows the page's
// title instead. An overlay that cannot say where it is covers the window.

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { create } from "zustand";

import { overlaps, type Box } from "./bounds";

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

/** Whether any hold covers `area`. */
export const covered = (holds: Readonly<Record<string, Hold>>, area: Box): boolean => Object.values(holds).some((hold) => hold === "all" || overlaps(hold, area));

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
