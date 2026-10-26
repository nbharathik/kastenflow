// What a timeline shows, read from the notes: which date properties the view
// uses, the notes with dates (bars and markers), the ones without, the lanes
// they sit in, and the target of a date change. Pure functions, unit tested.

import type { NoteMeta, PropDef, TagSchema, TagView } from "../../../../lib/vault/types";
import { asDay } from "../../../calendar/dates";
import type { MoveTarget } from "../../../calendar/use-moves";
import { titleOf } from "../../../workspace/names";
import { columnsOf, valueOf } from "../../model";
import { placeable, type Dates } from "./layout";

/** The properties a timeline reads and writes. */
export interface Keys {
  start: string;
  /** Null: items with a start are markers. */
  end: string | null;
  /** A calculated date can be shown but not moved. */
  startLocked: boolean;
  endLocked: boolean;
}

const isDateDef = (p: PropDef) => p.type === "date" || p.type === "formula";

/** The date properties of a tag, ones it writes first, then calculated ones. */
export const dateDefs = (schema: TagSchema | null): PropDef[] => (schema?.properties ?? []).filter(isDateDef);

/** The keys a view uses: its `start` and `end` when they name date properties
 * of the tag, else the first date property to start from; null when the tag
 * has none, which the view says in words. */
export function keysOf(view: TagView, schema: TagSchema | null): Keys | null {
  const defs = dateDefs(schema);
  const named = (key: unknown) => defs.find((d) => d.key === key);
  const written = defs.filter((d) => d.type === "date");
  const start = named(view.start) ?? written[0] ?? defs[0];
  if (!start) return null;
  const end = named(view.end);
  const real = end && end.key !== start.key ? end : undefined;
  return { start: start.key, end: real?.key ?? null, startLocked: start.type === "formula", endLocked: real?.type === "formula" };
}

/** The property that makes lanes: the view's `group_by` when it is a select, multi select or relation. */
export function laneDef(view: TagView, schema: TagSchema | null): PropDef | null {
  const def = (schema?.properties ?? []).find((p) => p.key === view.group_by);
  return def && (def.type === "select" || def.type === "multi_select" || def.type === "relation") ? def : null;
}

export interface Item {
  /** The note's path: one item per note. */
  id: string;
  note: NoteMeta;
  title: string;
  /** Null for a note without a usable start date. */
  dates: Dates | null;
  /** The end comes before the start: shown as a marker at the start, flagged. */
  reversed: boolean;
  /** The bar's dates are calculated, so it cannot be dragged. */
  locked: boolean;
}

export function itemOf(note: NoteMeta, keys: Keys): Item {
  const start = asDay(valueOf(note, keys.start));
  const end = keys.end === null ? null : asDay(valueOf(note, keys.end));
  const usable = start !== null && placeable(start);
  const dates: Dates | null = usable ? { start, end: end !== null && placeable(end) ? end : null } : null;
  return { id: note.path, note, title: titleOf(note), dates, reversed: dates?.end != null && dates.end < dates.start, locked: keys.startLocked || (dates?.end != null && keys.endLocked) };
}

const byDate = (a: Item, b: Item) => (a.dates?.start ?? "").localeCompare(b.dates?.start ?? "") || (a.dates?.end ?? "").localeCompare(b.dates?.end ?? "") || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/** The notes split into those with a start date, by start, and those without, in the order given. */
export function readItems(notes: readonly NoteMeta[], keys: Keys): { dated: Item[]; undated: Item[] } {
  const dated: Item[] = [];
  const undated: Item[] = [];
  for (const note of notes) {
    const item = itemOf(note, keys);
    (item.dates ? dated : undated).push(item);
  }
  return { dated: dated.sort(byDate), undated };
}

/** Dates moving somewhere, by note path, until the vault has them. */
export type Pending = ReadonlyMap<string, readonly string[]>;

/** The items shown at the days they are moving to. */
export function withPending(items: readonly Item[], pending: Pending): Item[] {
  if (pending.size === 0) return [...items];
  return items.map((item) => {
    const days = pending.get(item.id);
    if (!days || !item.dates || !days[0]) return item;
    const end = days.length > 1 ? (days[1] ?? null) : item.dates.end;
    return { ...item, dates: { start: days[0], end }, reversed: end !== null && end < days[0] };
  });
}

/** The change of dates for an item: its start, and its end when it has one. */
export function targetOf(item: Item, keys: Keys): MoveTarget {
  const hasEnd = keys.end !== null && item.dates?.end != null;
  return {
    id: item.id,
    path: item.id,
    note: item.note,
    keys: hasEnd ? [keys.start, keys.end!] : [keys.start],
    days: hasEnd ? [item.dates!.start, item.dates!.end!] : [item.dates!.start],
  };
}

/** The days an item holds, as the keys of its target are in order. */
export const daysOf = (dates: Dates, target: MoveTarget): string[] => (target.keys.length > 1 ? [dates.start, dates.end!] : [dates.start]);

/** The target for giving an undated note dates: its start, and its end if the view has one, both today. */
export function newDatesTarget(item: Item, keys: Keys, today: string): { target: MoveTarget; days: string[] } {
  const both = keys.end !== null && !keys.endLocked;
  return {
    target: { id: item.id, path: item.id, note: item.note, keys: both ? [keys.start, keys.end!] : [keys.start], days: both ? [today, today] : [today] },
    days: both ? [today, today] : [today],
  };
}

export interface Lane {
  /** Its option (null: the notes with none); empty for the single lane of a timeline without lanes. */
  key: string;
  label: string;
  items: Item[];
}

/** The lanes: one per option of the grouping property in order, "No <key>"
 * first when some items have none, values the schema does not list last. A
 * timeline without a grouping has one lane, with no label. */
export function lanesOf(items: readonly Item[], def: PropDef | null): Lane[] {
  if (!def) return [{ key: "", label: "", items: [...items] }];
  const byPath = new Map(items.map((item) => [item.id, item]));
  return columnsOf(
    items.map((item) => item.note),
    def,
  ).map((column) => ({ key: column.value ?? "\u0000", label: column.label, items: column.notes.map((n) => byPath.get(n.path)!) }));
}
