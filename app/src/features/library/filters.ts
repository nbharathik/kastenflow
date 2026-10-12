// The Card Library's rows, filters and sorts.
// Pure functions over the note list: rows are built once per list change,
// sorted once per sort change, then filtered on every keystroke, so 10,000
// notes stay smooth.

import type { NoteMeta, NoteStats } from "../../lib/vault/types";
import { iconOf, titleOf } from "../workspace/names";
import { openable } from "../workspace/tree";
import { dateFilterSpan, spanOfValue, type DateFilter, type Span } from "./date-filter";

export { updatedSince } from "./date-filter";

export type Kind = "all" | "card" | "page" | "project" | "journal";
export type SortKey = "updated" | "created" | "title" | "type" | "place" | "tags" | "boards" | "backlinks";
export type SortDir = "asc" | "desc";

export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export interface Filters {
  kind: Kind;
  /** A project's folder, or INBOX or PAGES; null for anywhere. */
  place: string | null;
  /** Lower-case tag, or null for any. */
  tag: string | null;
  /** When the note was last changed: a preset, a month or a range (date-filter.ts). */
  updated: DateFilter;
  /** When the note was made, by its own `created` date; notes without one never match. */
  created: DateFilter;
  /** Only notes on no board. */
  noBoard: boolean;
  /** Only notes with no links in or out and on no board. */
  orphans: boolean;
}

export const NO_FILTERS: Filters = { kind: "all", place: null, tag: null, updated: "any", created: "any", noBoard: false, orphans: false };

export const KINDS: readonly { id: Kind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "card", label: "Cards" },
  { id: "page", label: "Pages" },
  { id: "project", label: "Projects" },
  { id: "journal", label: "Journal" },
];

/** The sort menu's presets; table headers can sort by the other keys too. */
export const SORTS: readonly { key: SortKey; label: string; dir: SortDir }[] = [
  { key: "updated", label: "Updated", dir: "desc" },
  { key: "created", label: "Created", dir: "desc" },
  { key: "title", label: "Title", dir: "asc" },
  { key: "backlinks", label: "Most linked", dir: "desc" },
];

export const SORT_LABELS: Record<SortKey, string> = {
  updated: "Updated",
  created: "Created",
  title: "Title",
  type: "Type",
  place: "Project",
  tags: "Tags",
  boards: "Boards",
  backlinks: "Most linked",
};

/** The direction a key sorts in first: newest, biggest, or A to Z. */
export const firstDir = (key: SortKey): SortDir => (["updated", "created", "boards", "backlinks"].includes(key) ? "desc" : "asc");

// Places that are not project folders; a folder name never starts with ":".
export const INBOX = ":inbox";
export const PAGES = ":pages";
export const JOURNAL = ":journal";

export interface Row {
  note: NoteMeta;
  path: string;
  title: string;
  icon: string;
  /** Where it lives: a project's folder, or INBOX, PAGES or JOURNAL. */
  place: string;
  /** The place as shown: the project's title, "Inbox", "Pages" or "Journal". */
  placeLabel: string;
  /** Lower-case tags, for matching. */
  tags: string[];
  /** Lower-case title, tags and excerpt, for finding as you type. */
  haystack: string;
  /** Milliseconds. The note's own dates, else its file time, as the core's date filters. */
  created: number | null;
  updated: number;
}

/** A frontmatter date in milliseconds; a bare day counts from local midnight,
 * `days` later. */
export function parseDate(value: string | null | undefined, days = 0): number | null {
  const text = value?.trim();
  if (!text) return null;
  const day = text.length === 10 ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + days).getTime();
  const millis = Date.parse(text);
  return Number.isNaN(millis) ? null : millis;
}

// Rows by the note they were made from. The store keeps unchanged notes as
// the same objects, so after one note changes only its row is made again.
const made = new WeakMap<NoteMeta, Row>();

function rowFor(note: NoteMeta, projectTitles: ReadonlyMap<string, string>): Row {
  let place = PAGES;
  let placeLabel = "Pages";
  if (note.kind === "journal" || note.path.startsWith("journal/")) [place, placeLabel] = [JOURNAL, "Journal"];
  else if (note.path.startsWith("inbox/")) [place, placeLabel] = [INBOX, "Inbox"];
  else if (note.project) [place, placeLabel] = [note.project, projectTitles.get(note.project) ?? note.project];
  const known = made.get(note);
  // A renamed project changes the label on rows made before.
  if (known && known.placeLabel === placeLabel) return known;
  const title = titleOf(note);
  const tags = note.tags.map((t) => t.toLowerCase());
  const row: Row = {
    note,
    path: note.path,
    title,
    icon: iconOf(note),
    place,
    placeLabel,
    tags,
    haystack: `${title}\n${tags.join(" ")}\n${note.excerpt}`.toLowerCase(),
    created: parseDate(note.created),
    updated: parseDate(note.updated) ?? parseDate(note.created) ?? note.modified,
  };
  made.set(note, row);
  return row;
}

/** One row per note a person opens (templates stay out). */
export function buildRows(notes: NoteMeta[]): Row[] {
  const projectTitles = new Map<string, string>();
  for (const note of notes) if (note.kind === "project" && note.project) projectTitles.set(note.project, titleOf(note));
  return openable(notes).map((note) => rowFor(note, projectTitles));
}

export interface Query {
  /** Lower-case words and "quoted phrases" to find in the title, tags or excerpt. */
  words: string[];
  /** From `tag:x` and `#x`. */
  tags: string[];
  /** From `project:x`. */
  projects: string[];
  /** From `type:x`. */
  types: string[];
  /** From `after:YYYY-MM-DD` (the day after it starts) and `before:YYYY-MM-DD`
   * (that day starts), in milliseconds: both days themselves are left out, as
   * in the core. */
  after: number | null;
  before: number | null;
  /** From `on:` (a day, a month `2026-10`, a year or `a..b`): made or last
   * changed in it. `created:` is made in it, `updated:` last changed in it. */
  on: Span | null;
  created: Span | null;
  updated: Span | null;
}

/** Reads the search box the way the core's search does. */
export function parseQuery(text: string): Query {
  const query: Query = { words: [], tags: [], projects: [], types: [], after: null, before: null, on: null, created: null, updated: null };
  for (const match of text.toLowerCase().matchAll(/"([^"]*)"?|(\S+)/g)) {
    const [, phrase, token] = match;
    if (phrase !== undefined) {
      if (phrase.trim()) query.words.push(phrase.trim());
      continue;
    }
    const filter = /^(tag|project|type|after|before|on|created|updated):(.+)$/.exec(token!);
    const [key, value] = filter ? [filter[1], filter[2]!] : [null, token!];
    if (key === "tag" || (!key && value.startsWith("#") && value.length > 1)) query.tags.push(value.replace(/^#/, ""));
    else if (key === "project") query.projects.push(value);
    else if (key === "type") query.types.push(value);
    else if (key === "after") query.after = parseDate(value, 1);
    else if (key === "before") query.before = parseDate(value);
    else if (key === "on" || key === "created" || key === "updated") {
      // A value that is no date is an ordinary word, as in the core.
      const span = spanOfValue(value);
      if (span) query[key] = span;
      else query.words.push(token!);
    } else query.words.push(value);
  }
  return query;
}

/** Whether every word of the query is in the row's title, tags or excerpt. */
export const matchesWords = (row: Row, words: readonly string[]) => words.every((w) => row.haystack.includes(w));

export interface FilterContext {
  /** Link and board counts by path; null while they load. */
  stats: ReadonlyMap<string, NoteStats> | null;
  query: Query;
  /** Paths the full-text search found for the query, if it has answered. */
  hits: ReadonlySet<string> | ReadonlyMap<string, unknown> | null;
  now: number;
  /** The day weeks start on, for "This week" (Settings → Calendar): 1 Monday, 0 Sunday, 6 Saturday. */
  weekStart?: number;
}

const ZERO = { backlinks: 0, links: 0, boards: 0 };

const within = (millis: number | null, span: Span): boolean => millis !== null && millis >= span.from && millis < span.to;

/** The rows that pass every filter, in the order given. */
export function filterRows(rows: readonly Row[], filters: Filters, { stats, query, hits, now, weekStart = 1 }: FilterContext): Row[] {
  const updated = dateFilterSpan(filters.updated, now, weekStart);
  const created = dateFilterSpan(filters.created, now, weekStart);
  // Board and link counts decide nothing until they have loaded.
  const counted = stats !== null && (filters.noBoard || filters.orphans);
  return rows.filter((row) => {
    if (filters.kind !== "all" && row.note.kind !== filters.kind) return false;
    if (filters.place !== null && row.place !== filters.place) return false;
    if (filters.tag !== null && !row.tags.includes(filters.tag)) return false;
    if (updated && !within(row.updated, updated)) return false;
    if (created && !within(row.created, created)) return false;
    if (query.updated && !within(row.updated, query.updated)) return false;
    if (query.created && !within(row.created, query.created)) return false;
    if (query.on && !within(row.updated, query.on) && !within(row.created, query.on)) return false;
    if (counted) {
      const s = stats!.get(row.path) ?? ZERO;
      if (s.boards > 0) return false;
      if (filters.orphans && (s.backlinks > 0 || s.links > 0)) return false;
    }
    if (query.tags.some((t) => !row.tags.includes(t))) return false;
    if (query.types.some((t) => row.note.kind !== t)) return false;
    if (query.projects.some((p) => p !== row.place && p !== row.placeLabel.toLowerCase())) return false;
    if (query.after !== null && row.updated < query.after) return false;
    if (query.before !== null && row.updated >= query.before) return false;
    return matchesWords(row, query.words) || Boolean(hits?.has(row.path));
  });
}

export const hasFilters = (f: Filters) =>
  f.kind !== "all" || f.place !== null || f.tag !== null || f.updated !== "any" || f.created !== "any" || f.noBoard || f.orphans;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Rows in `sort` order. Missing dates and tags go last either way; ties go A to Z. */
export function sortRows(rows: readonly Row[], sort: Sort, stats: ReadonlyMap<string, NoteStats> | null): Row[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const count = (row: Row) => stats?.get(row.path) ?? ZERO;
  const compare = (a: Row, b: Row): number => {
    switch (sort.key) {
      case "updated":
        return dir * (a.updated - b.updated);
      case "created":
        if (a.created === null || b.created === null) return a.created === b.created ? 0 : a.created === null ? 1 : -1;
        return dir * (a.created - b.created);
      case "title":
        return dir * collator.compare(a.title, b.title);
      case "type":
        return dir * collator.compare(a.note.kind, b.note.kind);
      case "place":
        return dir * collator.compare(a.placeLabel, b.placeLabel);
      case "tags": {
        const [x, y] = [a.tags[0], b.tags[0]];
        if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
        return dir * collator.compare(x, y);
      }
      case "boards":
        return dir * (count(a).boards - count(b).boards);
      case "backlinks":
        return dir * (count(a).backlinks - count(b).backlinks || count(a).links - count(b).links);
    }
  };
  return [...rows].sort((a, b) => compare(a, b) || collator.compare(a.title, b.title) || (a.path < b.path ? -1 : 1));
}

export interface TagCount {
  /** Lower-case, as filters compare. */
  tag: string;
  /** As first written in a note. */
  label: string;
  count: number;
}

/** Every tag in use with its count, most used first. */
export function tagCounts(rows: readonly Row[]): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const row of rows) {
    for (const label of row.note.tags) {
      const tag = label.toLowerCase();
      const found = counts.get(tag);
      if (found) found.count++;
      else counts.set(tag, { tag, label, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
}

/** What the type column says. */
export const kindLabel = (kind: string) => (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Page");
