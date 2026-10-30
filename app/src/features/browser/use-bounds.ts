// Keeps a tab's native view over its placeholder. The placeholder is a plain
// element of the page; whatever moves or resizes it (the window, the display's
// scale, the app's zoom, a pane's divider, the sidebar, a panel, focus mode)
// is looked for, and the view's physical rectangle is sent once per animation
// frame, only when it changed. A change of layout is followed for a short
// burst of frames, so a sliding sidebar is followed to where it stops.

import { useEffect, useRef, useState, type RefObject } from "react";

import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { useShell } from "../../lib/store";
import { startInterval } from "../../lib/use-interval";
import { boxOf, isEmpty, sameBounds, toPhysical, type Box } from "./bounds";
import type { Bounds } from "./types";

/** Frames a change of layout is followed for. */
const BURST = 30;
/** How often layout is looked at when nothing said it changed, in milliseconds. */
const SLOW_MS = 500;

export interface Sync {
  /** Something may have moved: look at the next frame (and a few after). */
  poke(): void;
  stop(): void;
}

interface SyncOptions {
  measure(): Box | null;
  ratio(): number;
  /** Told when the view's place or size changed, with the box it comes from. */
  send(bounds: Bounds, box: Box): void;
  frame(run: () => void): number;
  cancel(id: number): void;
  burst?: number;
}

/** One look per frame however many pokes, one send per change. */
export function createSync({ measure, ratio, send, frame, cancel, burst = BURST }: SyncOptions): Sync {
  let waiting: number | null = null;
  let left = 0;
  let last: Bounds | null = null;
  let stopped = false;
  const look = () => {
    waiting = null;
    if (stopped) return;
    const box = measure();
    if (box && !isEmpty(box)) {
      const bounds = toPhysical(box, ratio());
      if (!sameBounds(last, bounds)) {
        last = bounds;
        send(bounds, box);
      }
    }
    if (left > 0) {
      left--;
      waiting = frame(look);
    }
  };
  return {
    poke() {
      if (stopped) return;
      left = burst;
      if (waiting === null) waiting = frame(look);
    },
    stop() {
      stopped = true;
      if (waiting !== null) cancel(waiting);
      waiting = null;
    },
  };
}

/** The placeholder's box, in CSS pixels, kept up to date; `onBounds` is told of each change in physical pixels. */
export function useBounds(placeholder: RefObject<HTMLElement | null>, onBounds: (bounds: Bounds) => void, active = true): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  const send = useRef(onBounds);
  useEffect(() => {
    send.current = onBounds;
  });

  useEffect(() => {
    const element = placeholder.current;
    if (!active || !element) return;
    const sync = createSync({
      measure: () => boxOf(element.getBoundingClientRect()),
      ratio: () => window.devicePixelRatio,
      send: (bounds, now) => {
        setBox(now);
        send.current(bounds);
      },
      frame: (run) => requestAnimationFrame(run),
      cancel: (id) => cancelAnimationFrame(id),
    });
    const poke = () => sync.poke();
    const stops: (() => void)[] = [];
    // The placeholder's own size, and the window's.
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(poke);
      observer.observe(element);
      stops.push(() => observer.disconnect());
    }
    window.addEventListener("resize", poke);
    document.addEventListener("transitionend", poke, true);
    document.addEventListener("animationend", poke, true);
    stops.push(() => {
      window.removeEventListener("resize", poke);
      document.removeEventListener("transitionend", poke, true);
      document.removeEventListener("animationend", poke, true);
    });
    // A display's scale or the page's zoom changes the pixel ratio: a media
    // query for the ratio now ends, and is made again for the next.
    let ratioQuery: MediaQueryList | null = null;
    const watchRatio = () => {
      ratioQuery?.removeEventListener("change", onRatio);
      ratioQuery = typeof window.matchMedia === "function" ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) : null;
      ratioQuery?.addEventListener("change", onRatio);
    };
    function onRatio() {
      poke();
      watchRatio();
    }
    watchRatio();
    stops.push(() => ratioQuery?.removeEventListener("change", onRatio));
    // Layout the page decides: panes, the sidebar, panels, focus mode.
    stops.push(useWorkspace.subscribe((s, p) => s.layout !== p.layout && poke()));
    stops.push(usePrefs.subscribe((s, p) => s.sidebarWidth !== p.sidebarWidth && poke()));
    stops.push(useShell.subscribe((s, p) => (s.sidebarOpen !== p.sidebarOpen || s.focusMode !== p.focusMode || s.panels !== p.panels) && poke()));
    // And a slow look for whatever else moved it.
    stops.push(startInterval(poke, SLOW_MS));
    poke();
    return () => {
      sync.stop();
      stops.forEach((stop) => stop());
    };
  }, [placeholder, active]);

  return box;
}
