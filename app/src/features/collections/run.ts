// Running a saved collection: its `when` becomes days, the days are added to
// the query, the search engine answers, and the tag views' filters and sorts
// are applied to what it found. Nothing here writes: a collection's notes are
// never stored, and dropping a note on one never changes the note.

import { addDays, dateOf, daysInMonth, isoDay, startOfWeek } from "../../lib/dates";
import { COLLECTION_LIMITS, type Collection, type CollectionWhen, type WhenToken } from "../../lib/vault/collection-types";
import type { NoteMeta, TagSchema, TagView, VaultClient } from "../../lib/vault/types";
import { applyView } from "../tags/model";

export interface DayRange {
  from: string;
  to: string;
}

/** How many notes a collection shows unless its display says. */
export const DEFAULT_SHOWN = 500;

const pad = (n: number, size = 2) => String(n).padStart(size, "0");

/** The days a span covers, both ends included, as of `today` (`YYYY-MM-DD`); `weekStart` is the day weeks start on (1 Monday, 0 Sunday). */
export function whenRange(token: WhenToken, today: string, weekStart = 1): DayRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (token) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case "this-week": {
      const from = isoDay(startOfWeek(dateOf(today), weekStart));
      return { from, to: addDays(from, 6) };
    }
    case "last-7-days":
      return { from: addDays(today, -7), to: today };
    case "last-30-days":
      return { from: addDays(today, -30), to: today };
    case "next-7-days":
      return { from: today, to: addDays(today, 7) };
    case "this-month":
      return { from: `${pad(year, 4)}-${pad(month)}-01`, to: `${pad(year, 4)}-${pad(month)}-${pad(daysInMonth(year, month))}` };
    case "last-month": {
      const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
      return { from: `${pad(y!, 4)}-${pad(m!)}-01`, to: `${pad(y!, 4)}-${pad(m!)}-${pad(daysInMonth(y!, m!))}` };
    }
    case "this-year":
      return { from: `${pad(year, 4)}-01-01`, to: `${pad(year, 4)}-12-31` };
  }
}

/** `updated:2026-09-10..2026-10-10`, one filter for each field a `when` names. */
export function expandWhen(when: CollectionWhen | null, today: string, weekStart = 1): string[] {
  if (!when) return [];
  return Object.entries(when).flatMap(([field, token]) => {
    if (!token) return [];
    const { from, to } = whenRange(token, today, weekStart);
    return [`${field}:${from}..${to}`];
  });
}

/** What goes to the search engine: the collection's query and its days. */
export function fullQuery(collection: Pick<Collection, "query" | "when">, today: string, weekStart = 1): string {
  return [collection.query.trim(), ...expandWhen(collection.when, today, weekStart)].filter((part) => part !== "").join(" ");
}

/** The collection as a tag database view, for the filters, sorts and columns. */
export function viewOf(collection: Collection): TagView {
  const display = collection.display ?? {};
  return {
    name: collection.name,
    type: display.type ?? "table",
    filter: collection.filter,
    sort: collection.sort.map((s) => ({ key: s.key, dir: s.dir ?? "asc" })),
    ...(display.columns ? { columns: display.columns } : {}),
  };
}

/** Every tag's properties as one schema, the first definition of a key winning, so a filter on `reading` sorts by its options. */
export function mergedSchema(schemas: readonly TagSchema[]): TagSchema {
  const seen = new Set<string>();
  const properties = schemas.flatMap((s) => s.properties).filter((p) => !seen.has(p.key) && seen.add(p.key));
  return { name: "", color: null, properties, views: [], path: "" };
}

/** The most notes a collection shows. */
export const shownLimit = (collection: Collection): number => Math.min(COLLECTION_LIMITS.shown, Math.max(1, collection.display?.limit ?? DEFAULT_SHOWN));

export interface CollectionRun {
  /** The notes, filtered and sorted, at most `shownLimit` of them. */
  notes: NoteMeta[];
  /** How many matched before the limit cut the list. */
  total: number;
  /** What was asked of the search engine; empty when the collection holds no words and no days. */
  query: string;
  /** The search engine stopped at its limit, so there may be more. */
  capped: boolean;
}

/** Runs a collection. With no words, no filters in the query and no days it is every note, from `notes` (the workspace's list); otherwise the search engine answers (at most 5,000) and its hits are mapped to `notes`. */
export async function runCollection(client: VaultClient, collection: Collection, notes: readonly NoteMeta[], today: string, weekStart = 1, schemas: readonly TagSchema[] = []): Promise<CollectionRun> {
  const query = fullQuery(collection, today, weekStart);
  let found: NoteMeta[];
  let capped = false;
  if (query === "") {
    found = notes.filter((n) => n.kind !== "template");
  } else {
    const hits = await client.search(query, COLLECTION_LIMITS.shown);
    capped = hits.length >= COLLECTION_LIMITS.shown;
    const byPath = new Map(notes.map((n) => [n.path, n]));
    found = hits.map((h) => byPath.get(h.path)).filter((n): n is NoteMeta => n !== undefined);
  }
  const shown = applyView(found, viewOf(collection), schemas.length > 0 ? mergedSchema(schemas) : null);
  return { notes: shown.slice(0, shownLimit(collection)), total: shown.length, query, capped };
}
