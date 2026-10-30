// What Home's "Today" lists, worked out from the day's events and to-dos and
// the time of day: the all-day events as chips, then "Meetings" (past ones
// folded away, the next one marked, overlaps noticed) and "Due today". Pure,
// so the clock is an argument.

import type { TaskRow } from "../../lib/vault/types";
import { byUrgency } from "../dashboard/task-rows";
import type { EventPart } from "../calendar/external/types";

/** Things shown in a group before "+N more". */
export const GROUP_LIMIT = 4;

/** `HH:MM` as minutes since midnight; `24:00` is 1440. Null for anything else. */
export function minutesOf(clock: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock ?? "");
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 1440 ? minutes : null;
}

export interface Meeting {
  part: EventPart;
  start: number;
  end: number;
  /** Titles of the meetings this one overlaps in time. */
  overlaps: string[];
}

export interface Todo {
  row: TaskRow;
  /** Minutes since midnight when the to-do names a time. */
  at: number | null;
}

export interface TodayModel {
  allDay: EventPart[];
  /** Meetings over by `now`. */
  earlier: Meeting[];
  /** The meeting on now and the ones still to come, in time order. */
  upcoming: Meeting[];
  /** The first meeting that has not begun, and the minutes until it does. */
  next: { meeting: Meeting; minutes: number } | null;
  /** Open to-dos due today: the timed ones by time, then the rest. */
  due: Todo[];
}

/** The to-dos that are due on `day`, open ones only, most urgent first. */
export const dueOn = (rows: readonly TaskRow[] | null, day: string): TaskRow[] => (rows ?? []).filter((r) => !r.done && r.due === day && !r.path.startsWith("templates/")).sort(byUrgency);

export function buildToday(parts: readonly EventPart[], rows: readonly TaskRow[] | null, day: string, now: number): TodayModel {
  const allDay: EventPart[] = [];
  const meetings: Meeting[] = [];
  for (const part of parts) {
    const start = minutesOf(part.at);
    if (start === null) {
      allDay.push(part);
      continue;
    }
    const end = Math.max(start, minutesOf(part.until) ?? start);
    meetings.push({ part, start, end, overlaps: [] });
  }
  // Numeric, not text: "9:00" comes before "10:00".
  meetings.sort((a, b) => a.start - b.start || a.end - b.end || a.part.event.title.localeCompare(b.part.event.title));
  // A day inside a longer event (00:00 to 24:00) overlaps everything and says nothing.
  const clashing = meetings.filter((m) => m.end - m.start < 1440);
  for (const a of clashing) {
    for (const b of clashing) {
      if (a !== b && a.start < b.end && b.start < a.end) a.overlaps.push(b.part.event.title);
    }
  }
  const earlier = meetings.filter((m) => m.end <= now && !(m.end === m.start && m.start >= now));
  const upcoming = meetings.filter((m) => !earlier.includes(m));
  const first = upcoming.find((m) => m.start > now);
  const due: Todo[] = dueOn(rows, day).map((row) => ({ row, at: minutesOf(row.at) }));
  // Array.sort is stable, so equal times keep their urgency order.
  due.sort((a, b) => (a.at === null ? 1 : 0) - (b.at === null ? 1 : 0) || (a.at ?? 0) - (b.at ?? 0));
  return { allDay, earlier, upcoming, next: first ? { meeting: first, minutes: first.start - now } : null, due };
}

/** "in 12 min", "in 1 h 20 min", "in 2 h". */
export function inWords(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
}

/** "day 2 of 3" for a part of a multi-day event; empty for a one-day one. */
export const spanWords = (part: EventPart): string => (part.span ? `day ${part.span[0]} of ${part.span[1]}` : "");

/** "Work", "Work and Home" or "Work, Home and Travel". */
export function namesOf(names: readonly string[]): string {
  if (names.length === 0) return "your calendar";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
