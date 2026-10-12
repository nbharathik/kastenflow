// What Home's recent list shows and how it is picked. A vault may hold ten
// thousand notes, so one pass over every note, whiteboard, deck and diagram
// keeps only the few that are shown, and counts the rest: nothing is sorted
// whole and nothing is built for rows that are not drawn.
//
// The order: the last few things you opened come first, then whatever changed
// last (a quick note caught a moment ago, a deck saved by another window).
// While you type, the better title matches come before that.

import type { BoardInfo, DeckInfo, DiagramInfo, NoteMeta } from "../../lib/vault/types";
import { lineIcon } from "../../ui/glyph";
import { CAPTURES_TAG } from "../extension/captures";
import { carries } from "../tags/model";
import { iconOf, titleOf } from "../workspace/names";
import { noteAt, openable } from "../workspace/tree";

export type ItemType = "page" | "card" | "board" | "deck" | "diagram" | "capture";
export type FilterId = "all" | ItemType;

/** The chips above the list, in order. */
export const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "page", label: "Pages" },
  { id: "card", label: "Cards" },
  { id: "board", label: "Boards" },
  { id: "deck", label: "Decks" },
  { id: "diagram", label: "Diagrams" },
  { id: "capture", label: "Captures" },
];

export const isFilter = (value: unknown): value is FilterId => FILTERS.some((f) => f.id === value);

/** The project choice for things that are in no project (a folder name never holds a slash). */
export const NO_PROJECT = "/";

/** How many of the latest opened things lead the list. */
const LEAD = 5;

export interface HomeItem {
  path: string;
  type: ItemType;
  title: string;
  /** An icon string (a person's emoji, or `icon:name`). */
  icon: string;
  /** The project's folder name, if it is in one. */
  project: string | null;
  modified: number;
}

export interface Sources {
  notes: readonly NoteMeta[];
  boards: readonly BoardInfo[];
  decks: readonly DeckInfo[];
  diagrams: readonly DiagramInfo[];
  /** Paths opened lately, newest first. */
  opened: readonly string[];
}

export interface Query {
  type: FilterId;
  /** A project's folder name, `NO_PROJECT`, or null for every project. */
  project: string | null;
  text: string;
}

export interface Picked {
  items: HomeItem[];
  /** How many things match, shown or not. */
  total: number;
}

export type Entry =
  | { kind: "note"; of: NoteMeta; path: string; modified: number; project: string | null; title: string }
  | { kind: "board"; of: BoardInfo; path: string; modified: number; project: string | null; title: string }
  | { kind: "deck"; of: DeckInfo; path: string; modified: number; project: string | null; title: string }
  | { kind: "diagram"; of: DiagramInfo; path: string; modified: number; project: string | null; title: string };

const shown = (note: NoteMeta) => note.kind !== "journal" && note.kind !== "chat" && note.kind !== "template";

/** Every thing the list may show, one call each. */
function each(src: Sources, visit: (entry: Entry) => void): void {
  for (const of of openable(src.notes)) if (shown(of)) visit({ kind: "note", of, path: of.path, modified: of.modified, project: of.project, title: of.title });
  for (const of of src.boards) visit({ kind: "board", of, path: of.path, modified: of.modified, project: of.project, title: of.title });
  for (const of of src.decks) visit({ kind: "deck", of, path: of.path, modified: of.modified, project: of.project, title: of.title });
  for (const of of src.diagrams) visit({ kind: "diagram", of, path: of.path, modified: of.modified, project: of.project, title: of.title });
}

/** The thing at `path`, if the vault has it and the list may show it. */
function find(src: Sources, path: string): Entry | null {
  if (path.endsWith(".canvas")) {
    const of = src.boards.find((b) => b.path === path);
    return of ? { kind: "board", of, path, modified: of.modified, project: of.project, title: of.title } : null;
  }
  if (path.endsWith(".deck")) {
    const of = src.decks.find((d) => d.path === path);
    return of ? { kind: "deck", of, path, modified: of.modified, project: of.project, title: of.title } : null;
  }
  if (path.endsWith(".drawio")) {
    const of = src.diagrams.find((d) => d.path === path);
    return of ? { kind: "diagram", of, path, modified: of.modified, project: of.project, title: of.title } : null;
  }
  const of = noteAt(src.notes, path);
  return of && shown(of) ? { kind: "note", of, path, modified: of.modified, project: of.project, title: of.title } : null;
}

/** What kind of thing an entry is, for the chips. Anything tagged `capture` is a capture. */
export function typeOf(entry: Entry): ItemType {
  if (entry.kind !== "note") return entry.kind;
  if (carries(entry.of, CAPTURES_TAG)) return "capture";
  return entry.of.kind === "card" || entry.of.kind === "highlight" ? "card" : "page";
}

/** How many of each kind there are: a chip for a kind that has none is left out. */
export function countTypes(src: Sources): Record<ItemType, number> {
  const counts: Record<ItemType, number> = { page: 0, card: 0, board: 0, deck: 0, diagram: 0, capture: 0 };
  each(src, (entry) => void counts[typeOf(entry)]++);
  return counts;
}

/** Titles in lower case, kept for as long as the thing itself is the same object. */
const lowered = new WeakMap<object, string>();
function lowerTitle(entry: Entry): string {
  let title = lowered.get(entry.of);
  if (title === undefined) {
    title = entry.title.toLowerCase();
    lowered.set(entry.of, title);
  }
  return title;
}

/** 0 for a title that starts with the words typed, 1 for one with a word that does, 2 for one that holds them, -1 for none. */
function score(entry: Entry, text: string): number {
  if (!text) return 0;
  const title = lowerTitle(entry);
  const at = title.indexOf(text);
  if (at < 0) return -1;
  return at === 0 ? 0 : /[\s\-_/([]/.test(title[at - 1]!) ? 1 : 2;
}

interface Scored {
  entry: Entry;
  score: number;
}

/** Whether `a` comes before `b`: the better match, then the newer, then by path so ties stay put. */
const before = (a: Scored, b: Scored): boolean =>
  a.score !== b.score ? a.score < b.score : a.entry.modified !== b.entry.modified ? a.entry.modified > b.entry.modified : a.entry.path < b.entry.path;

export function toItem(entry: Entry): HomeItem {
  const base = { path: entry.path, type: typeOf(entry), project: entry.project, modified: entry.modified };
  switch (entry.kind) {
    case "note":
      return { ...base, title: titleOf(entry.of), icon: iconOf(entry.of) };
    case "board":
      return { ...base, title: entry.title || "Untitled", icon: lineIcon("board") };
    case "deck":
      return { ...base, title: entry.title || "Untitled", icon: lineIcon("present") };
    case "diagram":
      return { ...base, title: entry.title || "Untitled", icon: lineIcon("diagram") };
  }
}

/** The `limit` things to show for `query`, and how many match in all. */
export function pick(src: Sources, query: Query, limit: number): Picked {
  const text = query.text.trim().toLowerCase();
  const matches = (entry: Entry): number => {
    if (query.project !== null && (query.project === NO_PROJECT ? entry.project !== null : entry.project !== query.project)) return -1;
    if (query.type !== "all" && typeOf(entry) !== query.type) return -1;
    return score(entry, text);
  };

  // The latest things opened lead, as long as they match.
  const lead: Scored[] = [];
  for (const path of src.opened) {
    if (lead.length >= LEAD) break;
    const entry = find(src, path);
    const s = entry ? matches(entry) : -1;
    if (entry && s >= 0 && !lead.some((l) => l.entry.path === path)) lead.push({ entry, score: s });
  }
  const led = new Set(lead.map((l) => l.entry.path));

  const best: Scored[] = [];
  let total = lead.length;
  const room = Math.max(0, limit - lead.length);
  each(src, (entry) => {
    if (led.has(entry.path)) return;
    const s = matches(entry);
    if (s < 0) return;
    total++;
    if (room === 0) return;
    const mine = { entry, score: s };
    if (best.length >= room && !before(mine, best[best.length - 1]!)) return;
    let at = best.length;
    while (at > 0 && before(mine, best[at - 1]!)) at--;
    best.splice(at, 0, mine);
    if (best.length > room) best.pop();
  });

  const all = [...lead.slice(0, limit), ...best];
  // While typing, a better match comes before an opened one (the sort keeps the rest in order).
  if (text) all.sort((a, b) => a.score - b.score);
  return { items: all.map((s) => toItem(s.entry)), total };
}
