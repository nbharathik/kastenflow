// What a person keeps the same on every whiteboard on this computer: whether
// the tool strip stays at full strength, the minimap, and what a double-click
// on empty space makes. Kept in this browser (a convenience, so a blocked or
// empty store only means the defaults), and read by the board as it opens.

import { create } from "zustand";

const KEY = "kasten.board.prefs";
/** Where the minimap switch was kept before there were more of them. */
const MINIMAP_KEY = "kasten.board.minimap";

export type DoubleClickMakes = "card" | "sticky";

export interface BoardPrefsValues {
  /** The tool strip stays at full strength; off, it rests quietly until the pointer comes. */
  alwaysToolbar: boolean;
  /** The minimap is shown. */
  minimap: boolean;
  /** What a double-click on empty space makes. */
  doubleClick: DoubleClickMakes;
}

interface BoardPrefs extends BoardPrefsValues {
  set(patch: Partial<BoardPrefsValues>): void;
}

const DEFAULTS: BoardPrefsValues = { alwaysToolbar: false, minimap: false, doubleClick: "card" };

function load(): BoardPrefsValues {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<BoardPrefsValues>;
    return {
      alwaysToolbar: typeof saved.alwaysToolbar === "boolean" ? saved.alwaysToolbar : DEFAULTS.alwaysToolbar,
      minimap: typeof saved.minimap === "boolean" ? saved.minimap : localStorage.getItem(MINIMAP_KEY) === "1",
      doubleClick: saved.doubleClick === "sticky" ? "sticky" : "card",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export const useBoardPrefs = create<BoardPrefs>()((set, get) => ({
  ...load(),
  set(patch) {
    set(patch);
    const { alwaysToolbar, minimap, doubleClick } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ alwaysToolbar, minimap, doubleClick }));
    } catch {
      // A convenience only.
    }
  },
}));
