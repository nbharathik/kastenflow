// The arithmetic of the timeline view: how wide a day is at each scale, the
// span of days the grid covers, where a bar starts and ends, the ticks and
// bands of the header, what a drag of so many pixels does to a bar's dates,
// and which row of a lane each bar sits in. Pure functions, unit tested; no
// React, no vault.

import { addDays, dateOf, daysBetween, daysInMonth, isoDay } from "../../../../lib/dates";

export type Scale = "week" | "month" | "quarter";

export const SCALES: readonly Scale[] = ["week", "month", "quarter"];

export const SCALE_LABELS: Record<Scale, string> = { week: "Week", month: "Month", quarter: "Quarter" };

/** How wide one day is, in pixels, at each scale. */
export const DAY_WIDTH: Record<Scale, number> = { week: 40, month: 14, quarter: 4 };

/** Days of room kept before the first and after the last date. */
const PAD: Record<Scale, number> = { week: 14, month: 30, quarter: 90 };

/** The fewest days the grid covers, so a sparse timeline still has a scale to read. */
const MIN_SPAN: Record<Scale, number> = { week: 42, month: 150, quarter: 540 };

/** Dates outside these are treated as mistakes: a year 0003 would make a grid miles wide. */
export const MIN_DAY = "1970-01-01";
export const MAX_DAY = "2100-12-31";

/** The scale a view asks for; month when it names none, or one that is not a scale. */
export const scaleOf = (value: unknown): Scale => (SCALES.includes(value as Scale) ? (value as Scale) : "month");

/** Whether a day is one the timeline can place. */
export const placeable = (day: string): boolean => day >= MIN_DAY && day <= MAX_DAY;

/** A run of days, both ends included. */
export interface Span {
  from: string;
  to: string;
}

/** How many days a span covers, both ends included. */
export const spanDays = (span: Span): number => daysBetween(span.from, span.to) + 1;

/** The pixel position of the left edge of `day`. */
export const xOf = (day: string, from: string, scale: Scale): number => daysBetween(from, day) * DAY_WIDTH[scale];

/** The width of a whole span. */
export const widthOf = (span: Span, scale: Scale): number => spanDays(span) * DAY_WIDTH[scale];

/** The day under pixel `x` of the grid (days start at their left edge). */
export const dayAt = (x: number, from: string, scale: Scale): string => addDays(from, Math.floor(x / DAY_WIDTH[scale]));

/** Whole days a pointer travel of `dx` pixels is worth; never -0. */
export const deltaDays = (dx: number, scale: Scale): number => Math.round(dx / DAY_WIDTH[scale]) || 0;

/** First day of the month, or of the quarter, holding `day`. */
function floorTo(day: string, scale: Scale): string {
  const date = dateOf(day);
  const month = scale === "quarter" ? Math.floor(date.getMonth() / 3) * 3 : date.getMonth();
  return isoDay(new Date(date.getFullYear(), month, 1));
}

/** Last day of the month, or of the quarter, holding `day`. */
function ceilTo(day: string, scale: Scale): string {
  const date = dateOf(day);
  const month = scale === "quarter" ? Math.floor(date.getMonth() / 3) * 3 + 2 : date.getMonth();
  const year = date.getFullYear();
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth(year, month + 1)).padStart(2, "0")}`;
}

/** The days the grid covers: every dated day and today, with room around,
 * at least `MIN_SPAN`, from the start of a month (quarter) to the end of one. */
export function viewSpan(days: readonly string[], today: string, scale: Scale): Span {
  let lo = today;
  let hi = today;
  for (const day of days) {
    if (day < lo) lo = day;
    if (day > hi) hi = day;
  }
  let from = addDays(lo, -PAD[scale]);
  let to = addDays(hi, PAD[scale]);
  const short = MIN_SPAN[scale] - (daysBetween(from, to) + 1);
  if (short > 0) {
    from = addDays(from, -Math.ceil(short / 2));
    to = addDays(to, Math.floor(short / 2));
  }
  return { from: floorTo(from, scale), to: ceilTo(to, scale) };
}

/** Where a bar sits: the box of a dated item. A bar covers its end day too;
 * a marker (no end) is one day wide, to be drawn centred in it. */
export function boxOf(start: string, end: string | null, from: string, scale: Scale): { left: number; width: number } {
  const dw = DAY_WIDTH[scale];
  const last = end !== null && end >= start ? end : start;
  return { left: xOf(start, from, scale), width: (daysBetween(start, last) + 1) * dw };
}

export interface Tick {
  day: string;
  x: number;
  /** What the header says: a day of the month, or a month's short name. */
  label: string;
  /** Read out in full by screen readers. */
  title: string;
  /** A tick that starts something bigger: a week, a month, a quarter. */
  strong: boolean;
}

export interface Band {
  day: string;
  x: number;
  width: number;
  /** "September 2026", or "2026" at the quarter scale. */
  label: string;
}

const MONTH_LONG = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const MONTH_SHORT = new Intl.DateTimeFormat(undefined, { month: "short" });
const FULL_DAY = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** The small ticks of the header: every day at the week scale, every Monday
 * at the month scale, the first of every month at the quarter scale. */
export function ticks(span: Span, scale: Scale): Tick[] {
  const out: Tick[] = [];
  let date = dateOf(span.from);
  const end = dateOf(span.to).getTime();
  while (date.getTime() <= end) {
    const day = isoDay(date);
    const dow = date.getDay();
    const of = date.getDate();
    const entry = (label: string, strong: boolean): Tick => ({ day, x: xOf(day, span.from, scale), label, title: FULL_DAY.format(date), strong });
    if (scale === "week") out.push(entry(String(of), dow === 1));
    else if (scale === "month" && dow === 1) out.push(entry(String(of), of <= 7));
    else if (scale === "quarter" && of === 1) out.push(entry(MONTH_SHORT.format(date), date.getMonth() % 3 === 0));
    date = new Date(date.getFullYear(), date.getMonth(), of + 1);
  }
  return out;
}

/** The big labels over the ticks: a band per month, or per year at the quarter scale. */
export function bands(span: Span, scale: Scale): Band[] {
  const out: Band[] = [];
  const dw = DAY_WIDTH[scale];
  const last = dateOf(span.to);
  let date = dateOf(span.from);
  while (date.getTime() <= last.getTime()) {
    const year = date.getFullYear();
    const month = date.getMonth();
    // The band ends with its month (year), or with the span.
    const stop = scale === "quarter" ? new Date(year, 11, 31) : new Date(year, month, daysInMonth(year, month + 1));
    const until = stop.getTime() < last.getTime() ? stop : last;
    const day = isoDay(date);
    const days = daysBetween(day, isoDay(until)) + 1;
    out.push({ day, x: xOf(day, span.from, scale), width: days * dw, label: scale === "quarter" ? String(year) : MONTH_LONG.format(date) });
    date = new Date(year, scale === "quarter" ? 12 : month + 1, 1);
  }
  return out;
}

/** What a drag or a key does to a bar's dates. */
export type Grip = "move" | "start" | "end";

export interface Dates {
  start: string;
  /** Null for a marker: an item with a start and no end. */
  end: string | null;
}

/** The dates after `grip` is carried `delta` days. Moving shifts both
 * together; the start edge cannot pass the end, nor the end go before the
 * start; nothing leaves the days the timeline can place. A marker has no
 * edges: only moving does anything. */
export function carry(dates: Dates, grip: Grip, delta: number): Dates {
  const { start, end } = dates;
  if (grip === "move" || end === null) {
    // Held back by whichever of its dates reaches the limit first.
    const lowest = end !== null && end < start ? end : start;
    const highest = end !== null && end > start ? end : start;
    const room = Math.max(daysBetween(lowest, MIN_DAY) * -1, 0);
    const space = Math.max(daysBetween(highest, MAX_DAY), 0);
    const d = Math.min(Math.max(delta, -room), space);
    return { start: addDays(start, d), end: end === null ? null : addDays(end, d) };
  }
  if (grip === "start") {
    const to = addDays(start, delta);
    return { start: to > end ? end : to < MIN_DAY ? MIN_DAY : to, end };
  }
  const to = addDays(end, delta);
  return { start, end: to < start ? start : to > MAX_DAY ? MAX_DAY : to };
}

/** One bar to be given a row: where it begins and where it (or its label) ends, in pixels. */
export interface Extent {
  id: string;
  left: number;
  right: number;
}

/** Rows of a lane: each bar goes to the first row where it clears the one
 * before it by `gap` pixels, in order of left edge. Returns the row of each
 * id and how many rows there are (at least one). */
export function packRows(extents: readonly Extent[], gap = 8): { rows: Map<string, number>; count: number } {
  const sorted = [...extents].sort((a, b) => a.left - b.left || a.right - b.right || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const extent of sorted) {
    let row = ends.findIndex((end) => end + gap <= extent.left);
    if (row < 0) row = ends.length;
    ends[row] = extent.right;
    rows.set(extent.id, row);
  }
  return { rows, count: Math.max(ends.length, 1) };
}
