// How the Slides view lists decks: found by words, ordered newest first (or by name, or by project), and remembered in this window.

import type { DeckInfo, NoteMeta } from "../../lib/vault/types";
import { projectTitle } from "../boards/store";

export type DeckSort = "recent" | "name" | "project";

export const SORTS: readonly { value: DeckSort; label: string }[] = [
  { value: "recent", label: "Last edited" },
  { value: "name", label: "Name" },
  { value: "project", label: "Project" },
];

const KEY = "kasten.slides.sort";

const isSort = (value: unknown): value is DeckSort => SORTS.some((sort) => sort.value === value);

/** The order the person chose last time; the newest first when there is none, or the window cannot say. */
export function readSort(): DeckSort {
  try {
    const stored = localStorage.getItem(KEY);
    return isSort(stored) ? stored : "recent";
  } catch {
    return "recent";
  }
}

export function writeSort(sort: DeckSort): void {
  try {
    localStorage.setItem(KEY, sort);
  } catch {
    // The choice holds for this window only.
  }
}

/** The decks whose title, or project, holds every word typed; all of them for nothing typed. */
export function filterDecks(list: readonly DeckInfo[], notes: readonly NoteMeta[], query: string): DeckInfo[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...list];
  return list.filter((deck) => {
    const text = `${deck.title} ${deck.project ? projectTitle(notes, deck.project) : ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

const byName = (a: DeckInfo, b: DeckInfo) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path);
const byRecent = (a: DeckInfo, b: DeckInfo) => b.modified - a.modified || byName(a, b);

/** The decks in the order asked for. `project` is the order of the groups' contents too: newest first inside each project. */
export function sortDecks(list: readonly DeckInfo[], sort: DeckSort): DeckInfo[] {
  return [...list].sort(sort === "name" ? byName : byRecent);
}

export interface Group {
  key: string;
  title: string;
  decks: DeckInfo[];
}

/** Decks by project (projects by title, loose decks last), newest first inside each. */
export function groupByProject(decks: readonly DeckInfo[], notes: readonly NoteMeta[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const deck of decks) {
    const key = deck.project ?? "";
    let group = byKey.get(key);
    if (!group) byKey.set(key, (group = { key, title: key ? projectTitle(notes, key) : "Not in a project", decks: [] }));
    group.decks.push(deck);
  }
  for (const group of byKey.values()) group.decks.sort(byRecent);
  return [...byKey.values()].sort((a, b) => ((a.key === "") !== (b.key === "") ? (a.key === "" ? 1 : -1) : a.title.localeCompare(b.title)));
}
