// What the overview's All tab lists: the project's pages, cards (captures
// among them), whiteboards and decks as one list, found as you type and
// filtered by type, tag and dates. Pure functions over the window's lists,
// using the Library's reading of the search box (`tag:`, `type:`, `on:`,
// `created:`, `updated:`, `after:`, `before:`) so both places mean the same.

import type { BoardInfo, DeckInfo, NoteMeta } from "../../../lib/vault/types";
import { dateFilterSpan, type DateFilter, type Span } from "../../library/date-filter";
import { parseDate, type Query } from "../../library/filters";
import { iconOf, titleOf } from "../../workspace/names";
import { lineIcon } from "../../../ui/glyph";

export type ItemKind = "page" | "card" | "board" | "deck";

export interface Item {
  /** Unique: the path. */
  key: string;
  kind: ItemKind;
  /** A card tagged `capture`. */
  capture: boolean;
  path: string;
  title: string;
  /** An emoji or a line icon's name (`ui/glyph.ts`). */
  icon: string;
  /** Lower case. */
  tags: string[];
  /** Milliseconds: the note's own dates, else its file time. */
  updated: number;
  created: number | null;
  /** Lower-case title, tags and excerpt, for finding as you type. */
  haystack: string;
  /** What a note's own kind says (`page`, `card`, `highlight`), for `type:`. */
  type: string;
  /** What it was made from, for the gallery's tiles. */
  note?: NoteMeta;
  board?: BoardInfo;
  deck?: DeckInfo;
}

export const CAPTURE_TAG = "capture";

const hasTag = (note: NoteMeta, tag: string) => note.tags.some((t) => t.toLowerCase() === tag);

/** A note as an item. */
function noteItem(note: NoteMeta): Item {
  const tags = note.tags.map((t) => t.toLowerCase());
  const title = titleOf(note);
  const card = note.kind !== "page";
  return {
    key: note.path,
    kind: card ? "card" : "page",
    capture: card && hasTag(note, CAPTURE_TAG),
    path: note.path,
    title,
    icon: iconOf(note),
    tags,
    updated: parseDate(note.updated) ?? parseDate(note.created) ?? note.modified,
    created: parseDate(note.created),
    haystack: `${title}\n${tags.join(" ")}\n${note.excerpt}`.toLowerCase(),
    type: note.kind,
    note,
  };
}

const boardItem = (board: BoardInfo): Item => ({ key: board.path, kind: "board", capture: false, path: board.path, title: board.title, icon: lineIcon("board"), tags: [], updated: board.modified, created: null, haystack: board.title.toLowerCase(), type: "board", board });
const deckItem = (deck: DeckInfo): Item => ({ key: deck.path, kind: "deck", capture: false, path: deck.path, title: deck.title, icon: lineIcon("present"), tags: [], updated: deck.modified, created: null, haystack: deck.title.toLowerCase(), type: "deck", deck });

/** Everything in the project at `folder`: its pages and cards (the project page itself left out), whiteboards and decks. */
export function itemsOf(notes: readonly NoteMeta[], boards: readonly BoardInfo[], decks: readonly DeckInfo[], folder: string): Item[] {
  const mine = notes.filter((n) => n.project === folder && n.kind !== "template" && n.kind !== "project" && n.kind !== "chat");
  return [...mine.map(noteItem), ...boards.filter((b) => b.project === folder).map(boardItem), ...decks.filter((d) => d.project === folder).map(deckItem)];
}

export interface ItemFilters {
  /** `all`, or one kind; cards include captures. */
  kind: ItemKind | "all";
  /** Lower case, or null for any. */
  tag: string | null;
  updated: DateFilter;
  created: DateFilter;
}

export const NO_FILTERS: ItemFilters = { kind: "all", tag: null, updated: "any", created: "any" };

export const hasFilters = (f: ItemFilters) => f.kind !== "all" || f.tag !== null || f.updated !== "any" || f.created !== "any";

const within = (millis: number | null, span: Span): boolean => millis !== null && millis >= span.from && millis < span.to;

export interface Context {
  query: Query;
  /** Paths the full-text search found for the typed words, once it has answered. */
  hits?: ReadonlySet<string> | ReadonlyMap<string, unknown> | null;
  now: number;
  weekStart?: number;
}

/** The items that pass the filters and the search box. A `project:` in the search is left alone: everything here is in the project already. */
export function filterItems(items: readonly Item[], filters: ItemFilters, { query, hits, now, weekStart = 1 }: Context): Item[] {
  const updated = dateFilterSpan(filters.updated, now, weekStart);
  const created = dateFilterSpan(filters.created, now, weekStart);
  return items.filter((item) => {
    if (filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.tag !== null && !item.tags.includes(filters.tag)) return false;
    if (updated && !within(item.updated, updated)) return false;
    if (created && !within(item.created, created)) return false;
    if (query.updated && !within(item.updated, query.updated)) return false;
    if (query.created && !within(item.created, query.created)) return false;
    if (query.on && !within(item.updated, query.on) && !within(item.created, query.on)) return false;
    if (query.tags.some((t) => !item.tags.includes(t))) return false;
    if (query.types.some((t) => item.type !== t && item.kind !== t)) return false;
    if (query.after !== null && item.updated < query.after) return false;
    if (query.before !== null && item.updated >= query.before) return false;
    return query.words.every((w) => item.haystack.includes(w)) || Boolean(hits?.has(item.path));
  });
}

export type SortKey = "updated" | "created" | "title" | "type";
export interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: Sort = { key: "updated", dir: "desc" };

/** The direction a key sorts in first: newest, or A to Z. */
export const firstDir = (key: SortKey): Sort["dir"] => (key === "updated" || key === "created" ? "desc" : "asc");

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Items in `sort` order; those with no date go last either way, ties go A to Z. */
export function sortItems(items: readonly Item[], sort: Sort): Item[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const compare = (a: Item, b: Item): number => {
    switch (sort.key) {
      case "updated":
        return dir * (a.updated - b.updated);
      case "created":
        if (a.created === null || b.created === null) return a.created === b.created ? 0 : a.created === null ? 1 : -1;
        return dir * (a.created - b.created);
      case "title":
        return dir * collator.compare(a.title, b.title);
      case "type":
        return dir * collator.compare(typeLabel(a), typeLabel(b));
    }
  };
  return [...items].sort((a, b) => compare(a, b) || collator.compare(a.title, b.title) || (a.path < b.path ? -1 : 1));
}

/** What the type column says. */
export function typeLabel(item: Pick<Item, "kind" | "capture">): string {
  if (item.capture) return "Capture";
  return { page: "Page", card: "Card", board: "Whiteboard", deck: "Deck" }[item.kind];
}

/** Every tag the items carry, the most used first. */
export function tagCounts(items: readonly Item[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
}

/** The captures among the project's notes (cards tagged `capture`), newest first, and those not filed in any project that could be. */
export function capturesOf(notes: readonly NoteMeta[], folder: string): { filed: NoteMeta[]; unfiled: NoteMeta[] } {
  const tagged = notes.filter((n) => n.kind !== "template" && hasTag(n, CAPTURE_TAG));
  const newest = (a: NoteMeta, b: NoteMeta) => b.modified - a.modified;
  return { filed: tagged.filter((n) => n.project === folder).sort(newest), unfiled: tagged.filter((n) => !n.project).sort(newest) };
}
