// Whether a page's properties show under its title or fold into one line.
// Each page remembers its own choice by note id (a window preference, so
// folding never writes the file); without one, Settings → Pages decides.

import type { NoteMeta } from "../../../lib/vault/types";
import { usePrefs, type PropsFold } from "../prefs";
import { useWorkspace } from "../store";

/** More properties than this fold by default, with "Folded when there are more than 5". */
export const FOLD_ABOVE = 5;

/** The key a page's choice is kept under: its id, which renames do not change. */
export const foldKey = (note: Pick<NoteMeta, "id" | "path">): string => note.id || note.path;

/** How many properties a note shows (its tags are listed beside the count). */
export const propertyCount = (note: Pick<NoteMeta, "props">): number => Object.keys(note.props).length;

/** Whether the block is folded: the page's own choice, else the default for `count` properties. */
export function isFolded(mode: PropsFold, choice: boolean | undefined, count: number): boolean {
  if (choice !== undefined) return choice;
  return mode === "folded" || (mode === "auto" && count > FOLD_ABOVE);
}

/** Remembers that `note`'s properties are folded or shown, by hand. */
export function setFoldChoice(note: Pick<NoteMeta, "id" | "path">, folded: boolean): void {
  const { propsFolded, set } = usePrefs.getState();
  const key = foldKey(note);
  if (propsFolded[key] !== folded) set({ propsFolded: { ...propsFolded, [key]: folded } });
}

/** Folds (true) or unfolds (false) the properties of `note`; says so when it has none. */
export function foldProperties(note: NoteMeta, folded: boolean): void {
  if (note.tags.length === 0 && propertyCount(note) === 0) {
    useWorkspace.getState().toast("This page has no properties yet: Add property in its header starts them.");
    return;
  }
  setFoldChoice(note, folded);
}

/** Flips the folded state of `note`'s properties. */
export function toggleFold(note: NoteMeta): void {
  const { propsFold, propsFolded } = usePrefs.getState();
  foldProperties(note, !isFolded(propsFold, propsFolded[foldKey(note)], propertyCount(note)));
}

/** The key action for Ctrl+Alt+P: flips the page in front. */
export function toggleFoldOfOpenPage(): void {
  const { place, notes } = useWorkspace.getState();
  const note = place.view === "page" && place.path ? notes.find((n) => n.path === place.path) : undefined;
  if (note) toggleFold(note);
}

/** Folds the properties of every page: forgets each page's own choice and makes folded the default. */
export function foldEveryPage(): void {
  usePrefs.getState().set({ propsFold: "folded", propsFolded: {} });
  useWorkspace.getState().toast("Properties are folded on every page. Settings → Pages changes this.");
}
