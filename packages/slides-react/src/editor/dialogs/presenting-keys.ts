// The keys of a show, for the editor's help: the shortcuts dialog's "Presenting" section and the "Presenting" card. The list is the show's
// own (`present/runtime/chrome.js`, the list its `?` shows), so the help and the show cannot differ.

import { INK_KEYS, LEAVE_KEY, PRESENTER_KEY, SHOW_KEYS, TIMER_KEYS } from "../../present/runtime/chrome.js";
import { keysOf } from "../commands/index.ts";

export interface PresentingKey {
  keys: string;
  what: string;
  /** Only in the presenter's own window, which times the talk. */
  presenterOnly?: boolean;
}

/** Every key of a show: the show's own list, the pen (the show in the app can draw), the presenter's view, the timer of the presenter's window, and leaving. */
export function presentingKeys(): PresentingKey[] {
  return [
    ...SHOW_KEYS.map(([keys, what]): PresentingKey => ({ keys, what })),
    ...INK_KEYS.map(([keys, what]): PresentingKey => ({ keys, what })),
    { keys: PRESENTER_KEY[0], what: PRESENTER_KEY[1] },
    ...TIMER_KEYS.map(([keys, what]): PresentingKey => ({ keys, what: `${what} (presenter view)`, presenterOnly: true })),
    { keys: LEAVE_KEY[0], what: LEAVE_KEY[1] },
  ];
}

/** The ways to start a show, with the editor's own keys for each. */
export function startingKeys(): { what: string; keys: string }[] {
  const rows: [string, string][] = [
    ["Present from this slide", "view.present"],
    ["Present from the beginning", "view.present-start"],
    ["Open the presenter's view", "view.presenter"],
  ];
  return rows.flatMap(([what, id]) => {
    const keys = keysOf(id);
    return keys ? [{ what, keys }] : [];
  });
}
