// Tab sets: a pane's tabs saved under a name, to open again together
// later (a window preference). Pinned tabs come back pinned. Pure.

import { samePlace, type Pane, type Place } from "./tabs";

export interface TabSet {
  name: string;
  tabs: { place: Place; pinned: boolean }[];
}

const VIEWS = new Set(["home", "page", "inbox", "journal", "calendar", "library", "tasks", "trash", "settings", "boards", "slides", "diagrams", "tags", "highlights", "chat", "history", "review", "import", "graph", "overview"]);

/** The pane's tabs as a set called `name`: Home left out, each place once. */
export function setOf(pane: Pane, name: string): TabSet | null {
  const tabs: TabSet["tabs"] = [];
  for (const tab of pane.tabs) {
    if (tab.place.view === "home" || tabs.some((t) => samePlace(t.place, tab.place))) continue;
    tabs.push({ place: { ...tab.place }, pinned: tab.pinned });
  }
  const title = name.replace(/\s+/g, " ").trim();
  return title && tabs.length > 0 ? { name: title, tabs } : null;
}

/** `sets` with `set` in it, replacing one of the same name. */
export function withSet(sets: readonly TabSet[], set: TabSet): TabSet[] {
  const same = (s: TabSet) => s.name.toLowerCase() === set.name.toLowerCase();
  return sets.some(same) ? sets.map((s) => (same(s) ? set : s)) : [...sets, set];
}

export const withoutSet = (sets: readonly TabSet[], name: string) => sets.filter((s) => s.name !== name);

/** Sets as stored, keeping only well-formed ones. */
export function readSets(value: unknown): TabSet[] {
  if (!Array.isArray(value)) return [];
  const out: TabSet[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { name, tabs } = item as Partial<TabSet>;
    if (typeof name !== "string" || !Array.isArray(tabs)) continue;
    const kept = tabs.filter((t) => t && typeof t === "object" && t.place && VIEWS.has(t.place.view) && (t.place.path === undefined || typeof t.place.path === "string"));
    if (kept.length) out.push({ name, tabs: kept.map((t) => ({ place: { view: t.place.view, ...(t.place.path ? { path: t.place.path } : {}) }, pinned: Boolean(t.pinned) })) });
  }
  return out;
}
