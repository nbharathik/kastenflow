// The Calendar view's arithmetic: which
// days a view draws and what it is called, what each day holds and how it
// fits a cell, where a moved item lands, which keys do what, and what a
// task made on the calendar carries. Pure functions, unit tested.

import { daysBetween, isoDay } from "../../lib/dates";
import type { DayMention, NoteMeta, TagSchema, TaskRow } from "../../lib/vault/types";
import { tagSwatch } from "../library/parts";
import type { Swatch } from "../panel/properties/schemas";
import { titleOf } from "../workspace/names";
import type { Dragged } from "./actions";
import { addDays, monthGrid, monthTitle, weekOf, type DateItem } from "./dates";
import type { EventPart } from "./external/types";
import { byStart, MAX_DAYS, rangeId, type DateRange } from "./ranges";

/** A month grid, a week of columns, or the month as a list of its days. */
export type Mode = "month" | "week" | "agenda";

/** One thing on a day: a note by one of its date properties, a range over
 * the day (in a day's popover), a dated to-do, a note that mentions the day
 * (`[[2026-10-01]]`), a note made on the day, or an event of a subscribed
 * calendar (read-only). */
export type Entry =
  | { kind: "note"; item: DateItem }
  | { kind: "range"; range: DateRange }
  | { kind: "task"; task: TaskRow }
  | { kind: "mention"; mention: DayMention }
  | { kind: "made"; note: NoteMeta }
  | { kind: "event"; part: EventPart };

const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
const dateOf = (day: string) => {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d);
};

/** An item's handle: one note's one date property. */
export const itemId = (item: Pick<DateItem, "path" | "key">) => `${item.path}#${item.key}`;

/** The days a view draws, a row per week: six for a month, one for a
 * week; the agenda's one row is the month's own days. */
export function periodDays(anchor: string, mode: Mode, weekStart = 1): string[][] {
  if (mode === "week") return [weekOf(anchor, weekStart)];
  const [y, m] = parts(anchor);
  const grid = monthGrid(y, m - 1, weekStart);
  if (mode === "month") return grid;
  const month = anchor.slice(0, 7);
  return [grid.flat().filter((day) => day.startsWith(month))];
}

/** The anchor a period before or after: a week away, or the first of the
 * month (today, when that is today's month). */
export function shiftAnchor(anchor: string, mode: Mode, step: number, today: string): string {
  if (mode === "week") return addDays(anchor, 7 * step);
  const [y, m] = parts(anchor);
  const first = isoDay(new Date(y, m - 1 + step, 1));
  return first.slice(0, 7) === today.slice(0, 7) ? today : first;
}

// One formatter each: making them per call (as toLocaleDateString does) is slow.
const RANGE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });
const SHORT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });
const LONG = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "Thursday, 24 September 2026", as `longDay` in lib/dates says it, with
 * one formatter for the hundreds of labels a month draws. */
export const fullDay = (day: string) => LONG.format(dateOf(day));

/** "September 2026", or a week as "September 21 – 27, 2026" in the reader's language. */
export function periodTitle(anchor: string, mode: Mode, weekStart = 1): string {
  if (mode !== "week") {
    const [y, m] = parts(anchor);
    return monthTitle(y, m - 1);
  }
  const week = weekOf(anchor, weekStart);
  return RANGE.formatRange(dateOf(week[0]!), dateOf(week[6]!));
}

/** "October 2", with the year when it is not `today`'s. */
export function dayLabel(day: string, today: string): string {
  return (day.slice(0, 4) === today.slice(0, 4) ? SHORT : RANGE).format(dateOf(day));
}

/** Range labels made so far: `formatRange` is slow, and a week can draw a
 * hundred bars, each named two or three times. */
const labels = new Map<string, string>();

function label(key: string, make: () => string): string {
  let text = labels.get(key);
  if (text === undefined) {
    if (labels.size > 5000) labels.clear();
    labels.set(key, (text = make()));
  }
  return text;
}

/** "October 1 – 5", with the year when either end is not in `today`'s. */
export function rangeLabel(start: string, end: string, today: string): string {
  if (start === end) return dayLabel(start, today);
  const year = today.slice(0, 4);
  const format = start.slice(0, 4) === year && end.slice(0, 4) === year ? SHORT : RANGE;
  return label(`${format === SHORT}${start}${end}`, () => format.formatRange(dateOf(start), dateOf(end)));
}

const BRIEF = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const BRIEF_YEAR = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** "Oct 1 – 5", as a bar says it; with the year when not `today`'s. */
export function briefRange(start: string, end: string, today: string): string {
  const year = today.slice(0, 4);
  const format = start.slice(0, 4) === year && end.slice(0, 4) === year ? BRIEF : BRIEF_YEAR;
  return label(`brief${format === BRIEF}${start}${end}`, () => (start === end ? format.format(dateOf(start)) : format.formatRange(dateOf(start), dateOf(end))));
}

/** Whether a note's status says it is finished. */
export function isDone(note: NoteMeta): boolean {
  const status = note.props.status;
  return (typeof status === "string" && /^(done|completed?|finished)$/i.test(status.trim())) || note.props.done === true;
}

const byTitle = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** The time of day (`HH:MM`) a to-do, a mention of the day or an event of a
 * subscribed calendar carries, if any. */
export const entryTime = (entry: Entry): string | null =>
  (entry.kind === "task" ? entry.task.at : entry.kind === "mention" ? entry.mention.at : entry.kind === "event" ? entry.part.at : null) ?? null;

/** A day's all-day events from subscribed calendars, then its notes, open
 * ones first and then by title, followed by its timed events, to-dos and
 * mentions in time order, then the to-dos, the notes that mention it and the
 * notes made on it with no time; a note already listed for the day is not
 * listed again. */
export function dayEntries(items: readonly DateItem[] = [], tasks: readonly TaskRow[] = [], mentions: readonly DayMention[] = [], made: readonly NoteMeta[] = [], events: readonly EventPart[] = []): Entry[] {
  const notes = items
    .map((item) => ({ item, done: isDone(item.note), title: titleOf(item.note) }))
    .sort((a, b) => Number(a.done) - Number(b.done) || byTitle.compare(a.title, b.title));
  const listed = new Set([...items.map((i) => i.path), ...tasks.map((t) => t.path)]);
  const fresh = (path: string) => !listed.has(path) && Boolean(listed.add(path));
  const todos = tasks.map((task): Entry => ({ kind: "task", task }));
  const links = mentions.filter((m) => fresh(m.path)).map((mention): Entry => ({ kind: "mention", mention }));
  // Times are zero-padded, so they order as text; equal times keep their order.
  const happenings = events.map((part): Entry => ({ kind: "event", part }));
  const timed = [...todos, ...links, ...happenings].filter((e) => entryTime(e) !== null).sort((a, b) => (entryTime(a)! < entryTime(b)! ? -1 : entryTime(a)! > entryTime(b)! ? 1 : 0));
  return [
    ...happenings.filter((e) => entryTime(e) === null),
    ...notes.map(({ item }): Entry => ({ kind: "note", item })),
    ...timed,
    ...todos.filter((e) => entryTime(e) === null),
    ...links.filter((e) => entryTime(e) === null),
    ...made.filter((n) => fresh(n.path)).map((note): Entry => ({ kind: "made", note })),
  ];
}

/** A to-do's text without the day it names (`@2026-10-02`, `📅 2026-10-02`,
 * `[[2026-10-02]]`) and the time after it (`09:00`, which its chip shows
 * apart): its cell already says the day. */
export function taskText(task: Pick<TaskRow, "text" | "due" | "at">): string {
  if (!task.due) return task.text;
  // As written the hour may lack its zero (`9:05`).
  const time = task.at ? `(?:\\s+0?${Number(task.at.slice(0, 2))}:${task.at.slice(3)}(?![\\d:]))?` : "";
  const marker = new RegExp(`\\s*(?:@|📅\\s?)?(?:\\[\\[)?${task.due}(?:\\|[^\\]]*)?(?:\\]\\])?(?![\\d-])${time}`, "gu");
  const text = task.text.replace(marker, "").replace(/\s{2,}/g, " ").trim();
  return text || task.text;
}

/** The entries a cell with `max` lines free shows: all when they fit, else
 * one line fewer and a "+N more" line, which also counts `hidden` bars that
 * did not fit. `keep` names one to show whatever its place, so a chip moved
 * by keyboard stays in sight. */
export function fit<T>(entries: readonly T[], max: number, keep?: (entry: T) => boolean, hidden = 0): { shown: readonly T[]; more: number } {
  if (!hidden && entries.length <= max) return { shown: entries, more: 0 };
  const shown = entries.slice(0, Math.max(0, max - 1));
  const kept = keep ? entries.find(keep) : undefined;
  if (kept !== undefined && shown.length && !shown.includes(kept)) shown[shown.length - 1] = kept;
  return { shown, more: hidden + entries.length - shown.length };
}

/** Where things are moving while the vault catches up, by item or range id:
 * the days their keys will hold (one for an item, start and end for a range). */
export type Pending = ReadonlyMap<string, readonly string[]>;

/** Items shown on the day they are moving to while the vault catches up. */
export function withMoves(items: readonly DateItem[], moves: Pending): readonly DateItem[] {
  if (moves.size === 0) return items;
  return items.map((item) => {
    const day = moves.get(itemId(item))?.[0];
    return day && day !== item.day ? { ...item, day } : item;
  });
}

/** Ranges shown where they are moving to, the list still by start. */
export function withRangeMoves(ranges: readonly DateRange[], moves: Pending): readonly DateRange[] {
  if (moves.size === 0) return ranges;
  const moved: DateRange[] = [];
  const kept = ranges.filter((range) => {
    const days = moves.get(rangeId(range));
    if (!days || (days[0] === range.start && days[1] === range.end)) return true;
    moved.push({ ...range, start: days[0]!, end: days[1]! });
    return false;
  });
  if (!moved.length) return ranges;
  const out: DateRange[] = [];
  let at = 0;
  for (const range of moved.sort(byStart)) {
    while (at < kept.length && byStart(kept[at]!, range) <= 0) out.push(kept[at++]!);
    out.push(range);
  }
  while (at < kept.length) out.push(kept[at++]!);
  return out;
}

/** A range's last day if moved to `day`: never before its start, nor so far
 * after it that the pair would stop being a range. */
export const clampEnd = (start: string, day: string) => (day < start ? start : daysBetween(start, day) >= MAX_DAYS ? addDays(start, MAX_DAYS - 1) : day);

/** Where a dragged thing lands when dropped on `day`: a chip on that day; a
 * range moved by as many days as the drop is from the day it was held by;
 * a range's end on that day. */
export function landing(dragged: Dragged, day: string): { start: string; end: string } {
  if (dragged.kind === "item") return { start: day, end: day };
  const { range } = dragged;
  if (dragged.kind === "end") return { start: range.start, end: clampEnd(range.start, day) };
  const by = daysBetween(dragged.from, day);
  return { start: addDays(range.start, by), end: addDays(range.end, by) };
}

/** A chip's or range's colours, as the Tag Database draws that tag: its tag's,
 * else the note's first coloured tag's; null for none (the accent). */
export function chipTone(item: Pick<DateItem, "tag" | "note">, colors: ReadonlyMap<string, string>): Swatch | null {
  const own = item.tag ? colors.get(item.tag.toLowerCase()) : undefined;
  if (own) return tagSwatch(own);
  for (const tag of item.note.tags) {
    const color = colors.get(tag.toLowerCase());
    if (color) return tagSwatch(color);
  }
  return null;
}

type Keys = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

export type CalendarKey = "prev" | "next" | "today" | "hours" | Mode;

/** The calendar's own keys, pressed outside a text field: ←/→ a period, T
 * today, M month, W week, A agenda, H the week's hour grid. */
export function calendarKey(event: Keys): CalendarKey | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key.length === 1 ? event.key.toLowerCase() : event.key) {
    case "ArrowLeft":
      return "prev";
    case "ArrowRight":
      return "next";
    case "t":
      return "today";
    case "m":
      return "month";
    case "w":
      return "week";
    case "a":
      return "agenda";
    case "h":
      return "hours";
    default:
      return null;
  }
}

const NUDGES: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** Days Alt+arrow moves a focused chip: one left or right, a week up or down. */
export function nudgeDays(event: Keys): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  return NUDGES[event.key] ?? null;
}

/** Days Alt+Shift+← / → move a focused range's end. */
export function stretchDays(event: Keys): number | null {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
  return event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
}

/** What a task added on a day carries: that day in the task tag's date
 * property (`due`) and its first status (`Todo`), in the schema's own names. */
export function newTaskProps(schema: TagSchema | undefined, day: string): Record<string, unknown> {
  if (!schema) return { due: day, status: "Todo" };
  const dates = schema.properties.filter((p) => p.type === "date");
  const date = dates.find((p) => p.key === "due") ?? dates[0];
  const props: Record<string, unknown> = { [date?.key ?? "due"]: day };
  const status = schema.properties.find((p) => p.key === "status");
  if (status?.type === "select" && status.options.length > 0) props.status = status.options.find((o) => o.toLowerCase() === "todo") ?? status.options[0];
  else if (status?.type === "text") props.status = "Todo";
  return props;
}
