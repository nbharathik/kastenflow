// A slide show fills the window. A native web view (a browser tab in a pane, an editor's web preview) is drawn above everything the
// window draws, so it would show through the show; presenting holds the whole window under one key for as long as the show lasts.
// The show's own peek of a web page is the one view that is meant to be above it, and ignores this key. The things that would open
// over the show without being asked (a toast, the chat dock) read `useShowing` and keep quiet.

import { create } from "zustand";

import { useOcclusion } from "./occlusion";

/** The key the show holds the window under; the show's own web preview does not count it. */
export const SHOW_HOLD = "slideshow";

interface Showing {
  /** Shows that hold the window now (one at a time, but counted so that a late release of one never frees another). */
  count: number;
}

export const useShowing = create<Showing>()(() => ({ count: 0 }));

/** Whether a show fills the window now. */
export const showing = (): boolean => useShowing.getState().count > 0;

/** The window is held for a show. Returns how to let go (more than once is fine). */
export function holdForShow(): () => void {
  useShowing.setState((s) => ({ count: s.count + 1 }));
  useOcclusion.getState().hold(SHOW_HOLD, "all");
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const count = Math.max(0, useShowing.getState().count - 1);
    useShowing.setState({ count });
    if (count === 0) useOcclusion.getState().release(SHOW_HOLD);
  };
}
