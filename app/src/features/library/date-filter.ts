// The Library's date filters: "Created" and "Updated" each take a preset
// (today, this or last week, this or last month), a chosen month or a
// custom range, and the search box takes `on:`, `created:` and `updated:`
// with a day, a month, a year or `a..b`. Spans are in milliseconds, from
// included to `to` excluded, in local time.

import { dateOf, isDay, startOfWeek, stampDay } from "../../lib/dates";

/** A preset's id, `month:2026-09`, or `range:2026-09-01..2026-09-15` (either
 * end may be empty). Stored as text in the Library's preferences. */
export type DateFilter = "any" | "today" | "week" | "last-week" | "month" | "last-month" | `month:${string}` | `range:${string}`;

export interface Span {
  from: number;
  to: number;
}

export const DATE_PRESETS: readonly { id: DateFilter; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
];

const PRESET_IDS: readonly string[] = DATE_PRESETS.map((p) => p.id);
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Local midnight of a day, whatever the year. */
function midnight(year: number, month: number, day: number): number {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month, day);
  return date.getTime();
}

/** One end of a typed range or one value: a year, a month or a day. `end`
 * gives the start of the next such unit (the span's `to`). */
function unitStart(text: string, end: boolean): number | null {
  const year = /^(\d{4})$/.exec(text);
  if (year) return midnight(Number(year[1]) + (end ? 1 : 0), 0, 1);
  const month = MONTH.exec(text);
  if (month) return midnight(Number(month[1]), Number(month[2]) - 1 + (end ? 1 : 0), 1);
  if (isDay(text)) return midnight(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)) + (end ? 1 : 0));
  return null;
}

/** What `on:`, `created:` and `updated:` take: `2026-10-07`, `2026-10`,
 * `2026`, `a..b`, `a..` or `..b`; null for anything else (it is a word then,
 * as the core reads it). */
export function spanOfValue(value: string): Span | null {
  const text = value.trim();
  const dots = text.indexOf("..");
  if (dots < 0) {
    const from = unitStart(text, false);
    return from === null ? null : { from, to: unitStart(text, true)! };
  }
  const [a, b] = [text.slice(0, dots), text.slice(dots + 2)];
  if (!a && !b) return null;
  const from = a ? unitStart(a, false) : Number.NEGATIVE_INFINITY;
  const to = b ? unitStart(b, true) : Number.POSITIVE_INFINITY;
  return from === null || to === null || from >= to ? null : { from, to };
}

/** A stored value as a filter: a preset, a month or a range that reads; else "any". */
export function readDateFilter(value: unknown): DateFilter {
  if (typeof value !== "string") return "any";
  if (PRESET_IDS.includes(value)) return value as DateFilter;
  if (value.startsWith("month:") && MONTH.test(value.slice(6))) return value as DateFilter;
  if (value.startsWith("range:") && spanOfValue(value.slice(6)) !== null && value.includes("..")) return value as DateFilter;
  return "any";
}

/** The span a filter means at `now`, weeks starting on `weekStart`; null for "any". */
export function dateFilterSpan(filter: DateFilter, now: number, weekStart = 1): Span | null {
  const d = new Date(now);
  const [y, m, day] = [d.getFullYear(), d.getMonth(), d.getDate()];
  switch (filter) {
    case "any":
      return null;
    case "today":
      return { from: midnight(y, m, day), to: midnight(y, m, day + 1) };
    case "week":
    case "last-week": {
      const first = startOfWeek(d, weekStart);
      const from = midnight(first.getFullYear(), first.getMonth(), first.getDate() + (filter === "week" ? 0 : -7));
      return { from, to: midnight(first.getFullYear(), first.getMonth(), first.getDate() + (filter === "week" ? 7 : 0)) };
    }
    case "month":
      return { from: midnight(y, m, 1), to: midnight(y, m + 1, 1) };
    case "last-month":
      return { from: midnight(y, m - 1, 1), to: midnight(y, m, 1) };
    default:
      return spanOfValue(filter.slice(filter.indexOf(":") + 1));
  }
}

/** When "Updated" starts for a filter: midnight, the first day of the week or
 * the 1st; minus infinity for "any". */
export const updatedSince = (filter: DateFilter, now: number, weekStart = 1): number => dateFilterSpan(filter, now, weekStart)?.from ?? Number.NEGATIVE_INFINITY;

const MONTH_NAME = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/** "October 2026" for `2026-10`. */
export const monthName = (month: string): string => {
  const match = MONTH.exec(month);
  return match ? MONTH_NAME.format(dateOf(`${month}-01`)) : month;
};

/** What a filter says on its button and in the list: "This week", "October 2026",
 * "1 Oct 2026 to 15 Oct 2026". */
export function dateFilterLabel(filter: DateFilter): string {
  const preset = DATE_PRESETS.find((p) => p.id === filter);
  if (preset) return preset.label;
  if (filter.startsWith("month:")) return monthName(filter.slice(6));
  const [from = "", to = ""] = filter.slice(6).split("..");
  const [a, b] = [from && isDay(from) ? stampDay(from) : from, to && isDay(to) ? stampDay(to) : to];
  if (a && b) return `${a} to ${b}`;
  return a ? `From ${a}` : `Until ${b}`;
}

/** The month filter for `2026-10`, or "any" for nothing. */
export const monthFilter = (month: string): DateFilter => (MONTH.test(month) ? `month:${month}` : "any");

/** The range filter for two days (`""` leaves an end open); "any" for neither,
 * or for an end before the start. */
export function rangeFilter(from: string, to: string): DateFilter {
  const [a, b] = [isDay(from) ? from : "", isDay(to) ? to : ""];
  if (!a && !b) return "any";
  return readDateFilter(`range:${a}..${b}`) === "any" ? "any" : `range:${a}..${b}`;
}

/** The two days of a range filter, `""` for an open end. */
export function rangeEnds(filter: DateFilter): [string, string] {
  if (!filter.startsWith("range:")) return ["", ""];
  const [from = "", to = ""] = filter.slice(6).split("..");
  return [from, to];
}
