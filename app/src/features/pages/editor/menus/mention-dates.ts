// The dates in the `@` menu: today, tomorrow and yesterday, the weekdays,
// and whatever was typed as a date or time ("next fri 3pm", "oct 12", "14:00";
// lib/natural-date.ts). A pick is the day as a link and, if a time was
// typed, the time as plain text after it: `[[2026-10-07]] 09:00`. The page
// title's `@` shows the same rows.

import { dayFrom, shortDay } from "../../../../lib/dates";
import { parseWhen, type When, type WhenOptions } from "../../../../lib/natural-date";
import type { MenuItem } from "../ui/popover";

/** What a date pick writes: the day's link target, and the text after the
 * link (`" 09:00"`, or none). */
export type PickDate = (day: string, after: string) => void;

/** A date row: what it says, and the day and time it stands for. */
export interface DateChoice {
  key: string;
  label: string;
  hint: string;
  when: When;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function choiceOf(when: When, now: Date, label?: string): DateChoice {
  const names: Record<string, string> = { [dayFrom(0, now)]: "Today", [dayFrom(1, now)]: "Tomorrow", [dayFrom(-1, now)]: "Yesterday" };
  const name = label ?? names[when.day] ?? shortDay(when.day);
  return { key: `day:${when.day}${when.time ? ` ${when.time}` : ""}`, label: when.time ? `${name}, ${when.time}` : name, hint: when.day, when };
}

/** `timeless` leaves a time typed with a day out of the rows: a page's date
 * (set from its title) is a day. */
export interface DateOptions extends WhenOptions {
  timeless?: boolean;
}

/** The dates to offer for `query` (what was typed after `@`): what it reads
 * as first, then the named days that start with it. Nothing for text that is
 * no date, a day that does not exist (`2026-13-45`) included. */
export function dateChoices(query: string, options: DateOptions = {}): DateChoice[] {
  const now = options.now ?? new Date();
  const q = query.trim().toLowerCase();
  const named: DateChoice[] = [0, 1, -1].map((offset) => choiceOf({ day: dayFrom(offset, now), time: null, dated: true }, now));
  // One letter is more often the start of a page's name than of a weekday.
  if (q.length >= 2) {
    for (const name of WEEKDAY_NAMES) {
      const when = parseWhen(name, { ...options, now });
      if (when) named.push(choiceOf(when, now, name));
    }
    const nextWeek = parseWhen("next week", { ...options, now });
    if (nextWeek) named.push(choiceOf(nextWeek, now, "Next week"));
  }
  // Today may also be a Wednesday: the first name that fits a day is the one shown.
  const rows: DateChoice[] = [];
  for (const c of named) {
    if ((c.label.toLowerCase().startsWith(q) || c.when.day.startsWith(q)) && !rows.some((r) => r.key === c.key)) rows.push(c);
  }
  const parsed = q ? parseWhen(q, { ...options, now }) : null;
  const typed = parsed && options.timeless ? { ...parsed, time: null } : parsed;
  if (typed) {
    const row = choiceOf(typed, now);
    if (!rows.some((r) => r.key === row.key)) rows.unshift(row);
  }
  return rows;
}

/** The menu rows for `dateChoices`. */
export function dateItems(query: string, options: DateOptions, pick: PickDate): MenuItem[] {
  return dateChoices(query, options).map((c) => ({
    key: c.key,
    label: c.label,
    hint: c.hint,
    icon: c.when.time ? "icon:clock" : "icon:calendar",
    onPick: () => pick(c.when.day, c.when.time ? ` ${c.when.time}` : ""),
  }));
}
