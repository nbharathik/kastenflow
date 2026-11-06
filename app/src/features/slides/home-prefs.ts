// What the Slides home remembers in this window: grid or list, which order, and the filters that follow from the decks there are.

import type { DeckInfo } from "../../lib/vault/types";
import { type DeckSort, SORTS, readSort } from "./deck-sort";

export type DeckView = "grid" | "list";

export const VIEWS: readonly { value: DeckView; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
];

const VIEW_KEY = "kasten.slides.view";

/** How the decks were laid out last time; a grid when there is none, or the window cannot say. */
export function readView(): DeckView {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function writeView(view: DeckView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // The choice holds for this window only.
  }
}

/** The orders the home offers: the project is a filter there, not an order. */
export const HOME_SORTS = SORTS.filter((sort) => sort.value !== "project");

/** The order chosen last time. One that grouped by project (an older window's) is the newest first now. */
export function readHomeSort(): DeckSort {
  const sort = readSort();
  return sort === "project" ? "recent" : sort;
}

/** The projects that hold at least one of the decks, as the keys the decks name. */
export function projectKeys(list: readonly DeckInfo[]): string[] {
  return [...new Set(list.flatMap((deck) => (deck.project ? [deck.project] : [])))];
}

/** The decks of one project; all of them for no project chosen, and the loose ones for `""`. */
export function inProject(list: readonly DeckInfo[], project: string | null): DeckInfo[] {
  if (project === null) return [...list];
  return list.filter((deck) => (deck.project ?? "") === project);
}
