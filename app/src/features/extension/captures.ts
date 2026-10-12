// The Captures entry in the sidebar: the `capture` tag's database, which is
// where what the browser tab and the browser extension keep ends up. It is
// listed once there is something in it, or a way to fill it is on.

import type { NoteMeta } from "../../lib/vault/types";
import { useBrowserOn, useBrowserPrefs } from "../browser/prefs";
import { carries } from "../tags/model";
import { tagPlace } from "../tags/place";
import { useWorkspace } from "../workspace/store";
import { useExtension, useExtensionOn } from "./store";

/** The tag every capture carries. */
export const CAPTURES_TAG = "capture";

/** Where the Captures entry goes: the tag's database. */
export const capturesPlace = tagPlace(CAPTURES_TAG);

let lastNotes: readonly NoteMeta[] | null = null;
let lastHas = false;

/** Whether any note carries the tag. Asked on every draw of the sidebar, so
 * the answer for the same list of notes is kept. */
export function hasCaptures(notes: readonly NoteMeta[]): boolean {
  if (notes !== lastNotes) {
    lastNotes = notes;
    lastHas = notes.some((n) => n.kind !== "template" && carries(n, CAPTURES_TAG));
  }
  return lastHas;
}

/** Whether the Captures entry is listed: there are captures, or the browser
 * or the extension is on. */
export function capturesShown(): boolean {
  return hasCaptures(useWorkspace.getState().notes) || useBrowserPrefs.getState().enabled || (useExtension.getState().status?.enabled ?? false);
}

/** `capturesShown` for a view that draws the list, drawn again when it changes. */
export function useCapturesShown(): boolean {
  const has = useWorkspace((s) => hasCaptures(s.notes));
  const browser = useBrowserOn();
  const extension = useExtensionOn();
  return has || browser || extension;
}

/** Whether `place` is the Captures database. */
export const isCapturesPlace = (place: { view: string; path?: string }): boolean => place.view === capturesPlace.view && place.path === capturesPlace.path;
