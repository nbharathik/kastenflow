// What the Settings window tells the rows it draws: whether a search is on
// and which settings it found, so a row can hide itself, mark the words it
// matched or jump to its page. Drawn alone (a group in a test), a row sees no
// search and shows.

import { createContext, useContext } from "react";

import { cardIds, entryById, groupById, type GroupId, type SettingEntry } from "./index";

export interface SettingsView {
  /** The group being drawn; null when a group is drawn on its own. */
  group: GroupId | null;
  /** The search words, none when not searching. */
  words: readonly string[];
  /** The entry ids the search found; null when not searching. */
  matching: ReadonlySet<string> | null;
  /** The row marked for a moment after a jump. */
  flash: string | null;
  /** Opens a setting's own group, at its row. */
  open(id: string): void;
}

export const IDLE: SettingsView = { group: null, words: [], matching: null, flash: null, open: () => {} };

export const SettingsViewContext = createContext<SettingsView>(IDLE);

export const useSettingsView = (): SettingsView => useContext(SettingsViewContext);

/** Whether the entry `id` is drawn now: always, unless a search is on and
 * it is not among what was found (or belongs to another group's page). */
export function drawn(view: SettingsView, id: string | undefined): boolean {
  if (view.matching === null) return true;
  if (!id || !view.matching.has(id)) return false;
  const entry = entryById(id);
  return !entry || view.group === null || entry.group === view.group;
}

/** Whether a card of the group's page (its own, or a named one) has
 * anything to draw now. */
export function cardDrawn(view: SettingsView, card: string): boolean {
  if (view.matching === null) return true;
  const group = view.group;
  if (group === null) return true;
  const known = cardIds(group, card);
  // A card the index does not know has no rows of its own to find.
  return known.some((id) => view.matching!.has(id));
}

/** The group's own card is named for the group. */
export const ownCard = (group: GroupId | null): string | null => (group ? groupById(group).title : null);

/** An entry, if `id` names one. */
export const entryOf = (id: string | undefined): SettingEntry | undefined => (id ? entryById(id) : undefined);
