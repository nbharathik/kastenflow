// What the deck preview hears: its page's events (they come from the app with
// the id `preview`, and are no tab's), and a key its native view had the
// keyboard for. One place the Slides host listens to, so a tab never sees them.

import type { BrowserEvent } from "./types";

/** The id the app gives the preview's events. No tab has it. */
export const PREVIEW_ID = "preview";

export type PreviewSignal = { type: "page"; event: BrowserEvent } | { type: "key"; key: "Escape" };

const listeners = new Set<(signal: PreviewSignal) => void>();

/** Hears the preview's events and keys. Returns how to stop. */
export function onPreviewSignal(listener: (signal: PreviewSignal) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sendPreviewSignal(signal: PreviewSignal): void {
  for (const listener of [...listeners]) listener(signal);
}
