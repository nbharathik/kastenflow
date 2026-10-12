// How an embed is being looked at in a presentation: its zoom, which is the page's own until the person changes it (and is not saved:
// a presentation never edits its deck), and whether the page has been handed the pointer ("click to interact"). While the page has
// it, Ctrl plus, minus and zero zoom the page, and Esc gives control back to the slide.

import { useCallback, useEffect, useState } from "react";

import { type Design, type Frame, type View, frameFor, stepZoom, viewOf } from "./scale.ts";
import { zoomKeyOf } from "./zoom-keys.ts";

export interface EmbedControl {
  view: View;
  frame: Frame;
  active: boolean;
  setActive(on: boolean): void;
  step(direction: 1 | -1): void;
  fit(): void;
  /** The page follows the box, with no zoom set. */
  fitted: boolean;
}

/** The control of one embed in a box of this size; `element` is what the deck says of how its page is seen. */
export function useEmbedControl(box: { w: number; h: number }, element: { design?: Partial<Design> | null; zoom?: number | null; fit?: string | null }, fallback?: Design): EmbedControl {
  const [override, setOverride] = useState<{ zoom: number | null } | null>(null);
  const [active, setActive] = useState(false);
  const base = viewOf(element, fallback);
  const view: View = override ? { ...base, zoom: override.zoom } : base;
  const frame = frameFor(box, view);

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = stepZoom(box, view, direction);
      if (next !== null) setOverride({ zoom: next });
    },
    [box.w, box.h, view.zoom, view.fit, view.design.w, view.design.h],
  );
  const fit = useCallback(() => setOverride({ zoom: null }), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActive(false);
        return;
      }
      const word = zoomKeyOf(event);
      if (word === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (word === "fit") fit();
      else step(word === "in" ? 1 : -1);
    };
    // Before the presentation's own keys: Esc here is the page's, and Ctrl and the plus key would otherwise zoom the whole window.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, step, fit]);

  return { view, frame, active, setActive, step, fit, fitted: view.zoom === null };
}
