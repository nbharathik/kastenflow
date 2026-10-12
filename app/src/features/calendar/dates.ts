// Notes on days: every date property of
// every note, as a single day or, paired with another, as a range
// (ranges.ts); what was made or edited each day; and the grids a month or a
// week draws. Pure functions over the notes list, cached per list.

import { isoDay, startOfWeek } from "../../lib/dates";
import type { NoteMeta, TagSchema } from "../../lib/vault/types";
import { byStart, findRanges, type DateRange } from "./ranges";

export { addDays } from "../../lib/dates";

/** One note on one day, by one of its date properties. */
export interface DateItem {
  path: string;
  note: NoteMeta;
  /** The property that holds the day, e.g. `due`. */
  key: string;
  day: string;
  /** The tag whose schema names the property, when one does. */
  tag: string | null;
}

/** Keys read as dates even without a schema saying so. */
const DATE_KEYS = new Set(["due", "date", "start", "end", "deadline", "scheduled"]);

/** A property value as a day: `2026-10-01` or a timestamp starting with one. */
export function asDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return isoDay(date) === `${y}-${m}-${d}` ? `${y}-${m}-${d}` : null;
}

/** Schemas, as a lookup of which tag makes which key a date. */
const typedCache = new WeakMap<readonly TagSchema[], Map<string, string>>();

function typedKeys(schemas: readonly TagSchema[]): Map<string, string> {
  let typed = typedCache.get(schemas);
  if (!typed) {
    typed = new Map();
    for (const schema of schemas) for (const prop of schema.properties) if (prop.type === "date") typed.set(`${schema.name.toLowerCase()}\u0000${prop.key}`, schema.name);
    typedCache.set(schemas, typed);
  }
  return typed;
}

/** A note's dates: its single days and its ranges. Never changed once made. */
interface NoteDates {
  items: readonly DateItem[];
  ranges: readonly DateRange[];
}

const UNDATED: NoteDates = { items: [], ranges: [] };

/** Each note's dates, kept while the note and the schemas stay the same. */
const noteCache = new WeakMap<NoteMeta, { schemas: readonly TagSchema[]; dates: NoteDates }>();

/** The tag (as the note spells it) whose schema makes `key` a date. */
function tagOf(note: NoteMeta, typed: Map<string, string>, key: string): string | null {
  for (const tag of note.tags) if (typed.has(`${tag.toLowerCase()}\u0000${key}`)) return tag;
  return null;
}

const NO_RANGES: DateRange[] = [];

function datesOf(note: NoteMeta, schemas: readonly TagSchema[]): NoteDates {
  const known = noteCache.get(note);
  if (known && known.schemas === schemas) return known.dates;
  let dates = UNDATED;
  if (note.kind !== "template" && note.props) {
    // Each property that reads as a day; most notes have one or none.
    let keys: string[] | null = null;
    let days: string[] | null = null;
    for (const key in note.props) {
      const day = asDay(note.props[key]);
      if (!day) continue;
      (keys ??= []).push(key);
      (days ??= []).push(day);
    }
    if (keys && days) {
      const typed = typedKeys(schemas);
      const ranges = keys.length > 1 ? findRanges(note, new Map(keys.map((key, i) => [key, days[i]!])), schemas, (key) => tagOf(note, typed, key)) : NO_RANGES;
      const items: DateItem[] = [];
      keys.forEach((key, i) => {
        // A range's two days are the range, not two more items.
        if (ranges.length && ranges.some((r) => r.startKey === key || r.endKey === key)) return;
        const tag = tagOf(note, typed, key);
        if (tag || DATE_KEYS.has(key)) items.push({ path: note.path, note, key, day: days[i]!, tag });
      });
      if (items.length || ranges.length) dates = { items, ranges };
    }
  }
  noteCache.set(note, { schemas, dates });
  return dates;
}

/** Day, then title, then path and key: a total order, so a list patched
 * after an edit is the very list a rebuild would give. */
function byDayThenTitle(a: DateItem, b: DateItem): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  const title = a.note.title.localeCompare(b.note.title);
  if (title) return title;
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** More changed notes than this, and the lists are built again. */
const MAX_PATCH = 64;

interface Lists {
  items: DateItem[];
  ranges: DateRange[];
}

interface Built extends Lists {
  notes: readonly NoteMeta[];
  schemas: readonly TagSchema[];
}

const builtCache = new WeakMap<readonly NoteMeta[], Built>();
/** The lists built last, which the next ones patch when little changed. */
let latest: Built | null = null;

/** The notes in `next` but not `prev`, and those gone; null when many changed. */
function changes(prev: readonly NoteMeta[], next: readonly NoteMeta[]): { fresh: NoteMeta[]; gone: Set<NoteMeta> } | null {
  if (Math.abs(prev.length - next.length) > MAX_PATCH) return null;
  const before = new Set(prev);
  const fresh: NoteMeta[] = [];
  for (const note of next) if (!before.delete(note) && fresh.push(note) > MAX_PATCH) return null;
  // What is left in `before` is gone from `next`.
  return before.size > MAX_PATCH ? null : { fresh, gone: before };
}

function merge<T>(a: readonly T[], b: readonly T[], order: (x: T, y: T) => number): T[] {
  const out: T[] = new Array(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length && j < b.length) out[k++] = order(a[i]!, b[j]!) <= 0 ? a[i++]! : b[j++]!;
  while (i < a.length) out[k++] = a[i++]!;
  while (j < b.length) out[k++] = b[j++]!;
  return out;
}

/** Every note's single days, by day, and ranges, by start, built from
 * scratch (each note's dates still come from its cache). `dateItems` and
 * `dateRanges` patch the last lists instead; tests compare the two. */
export function buildDates(notes: readonly NoteMeta[], schemas: readonly TagSchema[]): Lists {
  const items: DateItem[] = [];
  const ranges: DateRange[] = [];
  for (const note of notes) {
    const dates = datesOf(note, schemas);
    for (const item of dates.items) items.push(item);
    for (const range of dates.ranges) ranges.push(range);
  }
  return { items: items.sort(byDayThenTitle), ranges: ranges.sort(byStart) };
}

/** The last lists with the changed notes' dates taken out and their new ones
 * merged in; a list no changed note is on stays the very same list. Null
 * when many notes changed. */
function patch(prev: Built, notes: readonly NoteMeta[]): Lists | null {
  const diff = changes(prev.notes, notes);
  if (!diff) return null;
  const { fresh, gone } = diff;
  let { items, ranges } = prev;
  let goneItems = false;
  let goneRanges = false;
  for (const note of gone) {
    const had = datesOf(note, prev.schemas);
    goneItems ||= had.items.length > 0;
    goneRanges ||= had.ranges.length > 0;
  }
  if (goneItems) items = items.filter((item) => !gone.has(item.note));
  if (goneRanges) ranges = ranges.filter((range) => !gone.has(range.note));
  const addItems: DateItem[] = [];
  const addRanges: DateRange[] = [];
  for (const note of fresh) {
    const dates = datesOf(note, prev.schemas);
    for (const item of dates.items) addItems.push(item);
    for (const range of dates.ranges) addRanges.push(range);
  }
  if (addItems.length) items = merge(items, addItems.sort(byDayThenTitle), byDayThenTitle);
  if (addRanges.length) ranges = merge(ranges, addRanges.sort(byStart), byStart);
  return { items, ranges };
}

/** The lists for a notes list: cached, patched from the last ones when a
 * save changed a few notes, else built. */
function listsFor(notes: readonly NoteMeta[], schemas: readonly TagSchema[]): Built {
  const known = builtCache.get(notes);
  if (known && known.schemas === schemas) return known;
  const lists = (latest && latest.schemas === schemas ? patch(latest, notes) : null) ?? buildDates(notes, schemas);
  const built = { notes, schemas, ...lists };
  builtCache.set(notes, built);
  latest = built;
  return built;
}

/** Every date property of every note (templates aside) that is not half of
 * a range, by schema or by a well-known key such as `due`, by day. A save
 * changes one note, so the list before it is patched rather than built
 * again, and stays the same list when the note has no dates. */
export function dateItems(notes: readonly NoteMeta[], schemas: readonly TagSchema[]): DateItem[] {
  return listsFor(notes, schemas).items;
}

/** Every range of every note (templates aside), by start; see `dateItems`. */
export function dateRanges(notes: readonly NoteMeta[], schemas: readonly TagSchema[]): DateRange[] {
  return listsFor(notes, schemas).ranges;
}

/** Items by day. */
export function byDay<T extends { day: string }>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const list = out.get(item.day);
    if (list) list.push(item);
    else out.set(item.day, [item]);
  }
  return out;
}

/** The day a note was created on, from its `created` key. */
export const createdDay = (note: NoteMeta) => (note.created ? asDay(note.created) : null);

/** The local day a note was last changed on. */
export const editedDay = (note: NoteMeta) => isoDay(new Date(note.modified));

const activityCache = new WeakMap<readonly NoteMeta[], Map<string, { created: NoteMeta[]; edited: NoteMeta[] }>>();
/** Each note's made and edited days, read once per version of the note. */
const dayCache = new WeakMap<NoteMeta, { created: string | null; edited: string }>();

function daysOf(note: NoteMeta): { created: string | null; edited: string } {
  let days = dayCache.get(note);
  if (!days) dayCache.set(note, (days = { created: createdDay(note), edited: editedDay(note) }));
  return days;
}

/** Notes made and notes edited on each day (journal days and templates
 * aside): the "on this day" strip. */
export function activityByDay(notes: readonly NoteMeta[]): Map<string, { created: NoteMeta[]; edited: NoteMeta[] }> {
  let out = activityCache.get(notes);
  if (out) return out;
  out = new Map();
  const at = (day: string) => {
    let entry = out!.get(day);
    if (!entry) out!.set(day, (entry = { created: [], edited: [] }));
    return entry;
  };
  for (const note of notes) {
    if (note.kind === "template" || note.kind === "journal") continue;
    const { created, edited } = daysOf(note);
    if (created) at(created).created.push(note);
    if (edited !== created) at(edited).edited.push(note);
  }
  activityCache.set(notes, out);
  return out;
}

/** Six weeks of days covering `month` (0-11) of `year`, as a month view draws them. */
export function monthGrid(year: number, month: number, weekStart = 1): string[][] {
  const first = startOfWeek(new Date(year, month, 1), weekStart);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => isoDay(new Date(first.getFullYear(), first.getMonth(), first.getDate() + w * 7 + d))));
}

/** The seven days of the week holding `day`. */
export function weekOf(day: string, weekStart = 1): string[] {
  const [y, m, d] = day.split("-").map(Number);
  const first = startOfWeek(new Date(y!, m! - 1, d!), weekStart);
  return Array.from({ length: 7 }, (_, i) => isoDay(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)));
}

/** Short weekday names in the reader's language, from `weekStart`. */
export function weekdayNames(weekStart = 1, style: "short" | "narrow" = "short"): string[] {
  // 2026-06-01 is a Monday.
  return Array.from({ length: 7 }, (_, i) => new Date(2026, 5, 1 + ((i + weekStart - 1 + 7) % 7)).toLocaleDateString(undefined, { weekday: style }));
}

/** "September 2026". */
export const monthTitle = (year: number, month: number) => new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
