// What "Save as collection" keeps of a search: the Library's search box and
// its filters become a collection's query and its relative days. What the
// search box's syntax cannot say (the board and orphan toggles, which need
// counts, and the Inbox and Pages places) is left out, and said so.

import { isoDay, startOfWeek } from "../../lib/dates";
import type { CollectionEdits, CollectionWhen, WhenToken } from "../../lib/vault/collection-types";
import { rangeEnds, type DateFilter } from "../library/date-filter";
import { INBOX, JOURNAL, PAGES, type Filters } from "../library/filters";

export interface SavedSearch {
  /** The collection's keys. */
  edits: CollectionEdits;
  /** A name to start from. */
  name: string;
  /** What the collection cannot hold, in words, for the person to see. */
  dropped: string[];
}

/** The span of days a preset names, as a collection's `when` says it; null for one it has no word for. */
const PRESET_TOKENS: Partial<Record<DateFilter, WhenToken>> = { today: "today", week: "this-week", month: "this-month", "last-month": "last-month" };

/** `updated:2026-10`-style text for a filter a collection has no word for: a month, a range, or last week as the days it is now. */
function absolute(filter: DateFilter, now: Date, weekStart: number): string | null {
  if (filter.startsWith("month:")) return filter.slice(6);
  if (filter.startsWith("range:")) {
    const [from, to] = rangeEnds(filter);
    return `${from}..${to}`;
  }
  if (filter === "last-week") {
    const first = startOfWeek(now, weekStart);
    const from = isoDay(new Date(first.getFullYear(), first.getMonth(), first.getDate() - 7));
    const to = isoDay(new Date(first.getFullYear(), first.getMonth(), first.getDate() - 1));
    return `${from}..${to}`;
  }
  return null;
}

const PLACE_QUERY = (place: string): string | null => (place === JOURNAL ? "type:journal" : place === INBOX || place === PAGES ? null : `project:${place}`);

/** The collection that finds what the Library shows: the search box's text, the filters as query words, and the relative days as `when`. */
export function savedSearch(text: string, filters: Filters, weekStart = 1, now = new Date()): SavedSearch {
  const words = [text.trim()];
  const when: CollectionWhen = {};
  const dropped: string[] = [];
  if (filters.kind !== "all") words.push(`type:${filters.kind}`);
  if (filters.place !== null) {
    const query = PLACE_QUERY(filters.place);
    if (query) words.push(query);
    else dropped.push(filters.place === INBOX ? "the Inbox" : "Pages that are in no project");
  }
  if (filters.tag !== null) words.push(`#${filters.tag}`);
  for (const [field, filter] of [["updated", filters.updated], ["created", filters.created]] as const) {
    if (filter === "any") continue;
    const token = PRESET_TOKENS[filter];
    const days = token ? null : absolute(filter, now, weekStart);
    if (token) when[field] = token;
    else if (days) words.push(`${field}:${days}`);
  }
  if (filters.noBoard) dropped.push("“on no board”");
  if (filters.orphans) dropped.push("“no links in or out”");
  const query = words.filter((w) => w !== "").join(" ");
  const edits: CollectionEdits = { query };
  if (Object.keys(when).length > 0) edits.when = when;
  return { edits, name: nameFor(text, filters), dropped };
}

/** A name to start from: the words searched, else the tag or the project. */
function nameFor(text: string, filters: Filters): string {
  const typed = text.trim().replace(/\s+/g, " ");
  if (typed) return typed.length > 40 ? `${typed.slice(0, 39)}…` : typed;
  if (filters.tag) return `#${filters.tag}`;
  if (filters.place && !filters.place.startsWith(":")) return filters.place;
  return "Saved search";
}

/** The collection a search box's text alone makes (the stack's finder, the palette). */
export function savedQuery(text: string): SavedSearch {
  const query = text.trim();
  return { edits: { query }, name: query.length > 40 ? `${query.slice(0, 39)}…` : query || "Saved search", dropped: [] };
}
