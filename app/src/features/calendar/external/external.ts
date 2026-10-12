// Where subscribed calendars' events fall on the Calendar's days. Pure
// functions: the desktop app answers with each event's start and end on this
// computer's clock (`2026-10-12T14:30`, or a plain day for an all-day event),
// and this places them by local day, splitting what spans days.

import { daysBetween, relativeTime, shortDay } from "../../../lib/dates";
import { addDays } from "../dates";
import type { CalendarInfo, EventPart, ExternalEvent } from "./types";

const dayOf = (stamp: string) => stamp.slice(0, 10);
const clockOf = (stamp: string) => stamp.slice(11, 16);

const partKey = (event: ExternalEvent, day: string) => `${event.calendar}:${event.id}:${day}`;

/** The parts of one event on the days from `first` to `last`. */
export function partsOf(event: ExternalEvent, first: string, last: string): EventPart[] {
  const startDay = dayOf(event.start);
  let endDay = dayOf(event.end);
  if (endDay < startDay) endDay = startDay;
  let lastDay = endDay;
  if (!event.allDay && endDay > startDay && clockOf(event.end) === "00:00") {
    // An event that ends at midnight does not touch the day that begins.
    lastDay = addDays(endDay, -1);
  }
  const total = daysBetween(startDay, lastDay) + 1;
  const parts: EventPart[] = [];
  for (let day = startDay > first ? startDay : first; day <= lastDay && day <= last; day = addDays(day, 1)) {
    const span: [number, number] | null = total > 1 ? [daysBetween(startDay, day) + 1, total] : null;
    if (event.allDay) {
      parts.push({ event, day, at: null, until: null, span, key: partKey(event, day) });
      continue;
    }
    const at = day === startDay ? clockOf(event.start) : "00:00";
    const until = day < lastDay || endDay > lastDay ? "24:00" : clockOf(event.end);
    parts.push({ event, day, at, until, span, key: partKey(event, day) });
  }
  return parts;
}

/** All-day parts first, then by start time, then by title. */
export function byTime(a: EventPart, b: EventPart): number {
  if ((a.at === null) !== (b.at === null)) return a.at === null ? -1 : 1;
  if (a.at !== b.at && a.at !== null && b.at !== null) return a.at < b.at ? -1 : 1;
  return a.event.title.localeCompare(b.event.title);
}

/** The events' parts by day, for the days from `first` to `last`, in time order. */
export function partsByDay(events: readonly ExternalEvent[], first: string, last: string): Map<string, EventPart[]> {
  const out = new Map<string, EventPart[]>();
  for (const event of events) {
    for (const part of partsOf(event, first, last)) {
      const list = out.get(part.day);
      if (list) list.push(part);
      else out.set(part.day, [part]);
    }
  }
  for (const list of out.values()) list.sort(byTime);
  return out;
}

/** The events of the calendars that are shown; all of them while the list of
 * calendars is not known yet. */
export function shownEvents(events: readonly ExternalEvent[], calendars: readonly CalendarInfo[] | null): readonly ExternalEvent[] {
  if (!calendars) return events;
  const shown = new Set(calendars.filter((c) => c.shown).map((c) => c.id));
  return events.filter((e) => shown.has(e.calendar));
}

/** A part's hours: `09:00`, or `09:00–09:30` when it ends the same day. */
export function hoursOf(part: EventPart): string | null {
  if (part.at === null) return null;
  return part.until && part.until !== part.at && part.until !== "24:00" ? `${part.at}–${part.until}` : part.at;
}

/** When an event is, in words, for its popover. */
export function whenText(event: ExternalEvent): string {
  const startDay = dayOf(event.start);
  const endDay = dayOf(event.end);
  if (event.allDay) {
    if (endDay <= startDay) return `${shortDay(startDay)}, all day`;
    const days = daysBetween(startDay, endDay) + 1;
    return `${shortDay(startDay)} to ${shortDay(endDay)}, ${days} days`;
  }
  const from = clockOf(event.start);
  const to = clockOf(event.end);
  if (endDay === startDay) return from === to ? `${shortDay(startDay)}, ${from}` : `${shortDay(startDay)}, ${from}–${to}`;
  return `${shortDay(startDay)}, ${from} to ${shortDay(endDay)}, ${to}`;
}

/** "Updated 5 minutes ago", or why it was not, for a subscription. */
export function freshness(info: Pick<CalendarInfo, "lastUpdated" | "error">, now = Date.now()): string {
  const when = info.lastUpdated === null ? "Not fetched yet" : `Updated ${relativeTime(info.lastUpdated * 1000, now)}`;
  return info.error ? `${when}. Offline or refused: showing the last copy` : when;
}

/** The calendar an event belongs to, by id. */
export function calendarOf(calendars: readonly CalendarInfo[] | null, id: string): CalendarInfo | undefined {
  return calendars?.find((c) => c.id === id);
}
