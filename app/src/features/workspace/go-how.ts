// What `go` does for a way to open a place, once the settings are applied:
// pages in new tabs, how views peek, and that a deck has no peek.

import type { PeekSide } from "../peek/store";
import type { PeekMode } from "./prefs";
import type { OpenHow } from "./store-layout";
import { focusedPane, opensOwnTab, samePlace, type Layout, type Place } from "./tabs";

/** The way a place opens in the end: one of the ways the layout has, or a
 * peek, in the side or center (null: the mode the open peek has). */
export type Way = { how: "here" | "tab" | "split" | "right" | "stack" } | { peek: PeekSide | null };

export interface Situation {
  /** The focused tab's place. */
  current: Place;
  layout: Layout;
  /** Settings: a click on a page opens it in a tab of its own. */
  newTabs: boolean;
  /** Settings: how a page picked in a view opens. */
  peekMode: PeekMode;
  /** The mode of the peek open now, if one is. */
  peekOpen: PeekSide | null;
}

/** A deck and a diagram have no peek: they open as a full tab. */
const fullTabOnly = (place: Place): boolean => Boolean(place.path) && (place.view === "slides" || place.view === "diagrams");

/** A peek shows a page, a whiteboard or a PDF: not a deck, a diagram, a view or a tag database. */
const peekable = (place: Place): boolean => Boolean(place.path) && !fullTabOnly(place) && !place.path!.startsWith("#");

export function wayToOpen(asked: OpenHow, place: Place, now: Situation): Way {
  let how = asked;
  if (how === "peek-side" || how === "peek-center") {
    if (peekable(place)) return { peek: how === "peek-side" ? "side" : "center" };
    // A deck opens as a full tab, the way it would if peeking were refused.
    how = fullTabOnly(place) ? "tab" : "here";
  } else if (how === "peek") {
    if (peekable(place)) {
      // A link followed in a peek keeps that peek's mode.
      if (now.peekOpen) return { peek: null };
      if (now.peekMode !== "full") return { peek: now.peekMode };
    } else if (fullTabOnly(place) && now.peekMode !== "full") {
      how = "tab";
    }
    if (how === "peek") how = "here";
  }
  // The peek is settled before pages open in new tabs, so a view's click with
  // "Full page" chosen gets its own tab as a plain click does. A place
  // already open in a tab is gone back to there.
  if (how === "here" && now.newTabs) {
    const open = focusedPane(now.layout).tabs.some((t) => samePlace(t.place, place));
    if (open || opensOwnTab(now.current, place)) how = "tab";
  }
  return { how: how as Exclude<OpenHow, "peek" | "peek-side" | "peek-center"> };
}
