// The week's hour grid: which of a day's entries have an hour (a subscribed
// calendar's timed event, a to-do or mention with `@14:00`) and where each
// sits on the day. The rest stay in the all-day row above. Pure functions.

import { type Entry, entryTime } from "../layout";
import { stackSpans } from "../lanes";

/** A day's height in the grid is 24 of these. */
export const HOUR_PX = 44;
/** How long a to-do or mention with only a start time is drawn. */
export const POINT_MINUTES = 30;
/** The first hour in view when nothing earlier is on the week. */
export const FIRST_HOUR = 7;

/** `HH:MM` (or `24:00`) as minutes from midnight. */
export function minutesOf(clock: string): number {
  const hours = Number(clock.slice(0, 2));
  const minutes = Number(clock.slice(3, 5));
  return Math.min(1440, Math.max(0, hours * 60 + minutes));
}

/** An entry's end, in minutes: an event's own, else a short stretch. */
function endOf(entry: Entry, start: number): number {
  const until = entry.kind === "event" ? entry.part.until : null;
  const end = until ? minutesOf(until) : start + POINT_MINUTES;
  return Math.min(1440, Math.max(end, start + POINT_MINUTES));
}

/** An entry on the hours, with its minutes. */
export interface Block {
  entry: Entry;
  start: number;
  end: number;
}

/** A block placed on a day: its column among the ones it overlaps, and its
 * place in pixels. */
export interface Placed extends Block {
  lane: number;
  lanes: number;
  top: number;
  height: number;
}

/** A day's entries split into those with an hour and those without. */
export function splitDay(entries: readonly Entry[]): { allDay: Entry[]; timed: Block[] } {
  const allDay: Entry[] = [];
  const timed: Block[] = [];
  for (const entry of entries) {
    const at = entryTime(entry);
    if (at === null) {
      allDay.push(entry);
      continue;
    }
    const start = Math.min(1440 - POINT_MINUTES, minutesOf(at));
    timed.push({ entry, start, end: endOf(entry, start) });
  }
  return { allDay, timed };
}

/** The blocks of a day with their columns and places. */
export function placeBlocks(blocks: readonly Block[]): Placed[] {
  const stacked = stackSpans(blocks);
  return blocks.map((block, i) => ({
    ...block,
    ...stacked[i]!,
    top: (block.start / 60) * HOUR_PX,
    height: ((block.end - block.start) / 60) * HOUR_PX,
  }));
}

/** The hour the grid starts in view at: an hour before the first thing on
 * the week, or an hour before now when this is the current week, else the
 * usual start of a day. */
export function startHour(blocks: readonly Block[], now: Date | null): number {
  if (now) return Math.max(0, now.getHours() - 1);
  if (blocks.length === 0) return FIRST_HOUR;
  const first = Math.min(...blocks.map((b) => b.start));
  return Math.max(0, Math.min(FIRST_HOUR, Math.floor(first / 60) - 1));
}
