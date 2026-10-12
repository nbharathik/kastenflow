// Dates and times as people type them, for the `@` menu: "tomorrow", "fri",
// "next fri 3pm", "in 3 days", "oct 12", "12 oct 2027", "2026-10-07 14:00",
// "14:00", "2pm", "noon", "now". Nothing here reads the clock or the
// preferences: the caller passes `now` and the day weeks start on, so every
// rule can be tested.

import { addDays, isoDay, isRealDate, startOfWeek } from "./dates";

export interface WhenOptions {
  /** The moment "today" and "now" mean. */
  now?: Date;
  /** The day weeks start on: 1 Monday (the default), 0 Sunday, 6 Saturday. */
  weekStart?: number;
}

/** A day and, if one was typed, a time of day. */
export interface When {
  /** `YYYY-MM-DD`, a day that exists. */
  day: string;
  /** `HH:MM` on 24 hours. */
  time: string | null;
  /** False when only a time was typed, so the day is today by default. */
  dated: boolean;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Short forms that are not the start of the full name. */
const WEEKDAY_ALIASES: Record<string, number> = { weds: 3 };

/** The index of the word in `words` that `typed` starts (three letters or more). */
function wordIndex(words: readonly string[], typed: string): number {
  return typed.length >= 3 ? words.findIndex((word) => word.startsWith(typed)) : -1;
}

const weekdayOf = (typed: string) => WEEKDAY_ALIASES[typed] ?? wordIndex(WEEKDAYS, typed);

const pad = (n: number) => String(n).padStart(2, "0");

// A clock time at the end of the text or the start of it: `14:00`, `2pm`,
// `2:30 pm`, `noon`, `midnight`, `now`, each with an optional "at" or "@".
const CLOCK = "(?:\\d{1,2}:\\d{2}(?:\\s*[ap]m)?|\\d{1,2}\\s*[ap]m|noon|midnight|now)";
const TRAILING = new RegExp(`(?:^|\\s)(?:at\\s+|@\\s*)?(${CLOCK})$`);
const LEADING = new RegExp(`^(?:at\\s+|@\\s*)?(${CLOCK})(?:\\s+(?:on\\s+)?|$)`);

/** `HH:MM` for a clock word, or null when it is no time (`25:00`, `13pm`). */
function clockTime(word: string, now: Date): string | null {
  if (word === "noon") return "12:00";
  if (word === "midnight") return "00:00";
  if (word === "now") return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/.exec(word);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3] === "pm" ? 12 : 0);
  } else if (hour > 23) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

const dayText = (year: number, month: number, day: number) => `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;

/** A month and day, in the year typed, or else the next one on or after
 * `today` (Feb 29 waits for the next leap year); null when no such day exists. */
function monthDay(month: number, day: number, year: number | null, today: Date): string | null {
  if (year !== null) return isRealDate(year, month, day) ? dayText(year, month, day) : null;
  const from = isoDay(today);
  for (let y = today.getFullYear(); y <= today.getFullYear() + 8; y++) {
    if (isRealDate(y, month, day) && dayText(y, month, day) >= from) return dayText(y, month, day);
  }
  return null;
}

type Reach = "upcoming" | "next" | "last";

/** A weekday (0 Sunday to 6): upcoming is the first on or after today, `next`
 * and `last` the one in the week after or before this week, weeks starting on `weekStart`. */
function weekday(target: number, reach: Reach, today: Date, weekStart: number): string {
  if (reach === "upcoming") return addDays(isoDay(today), (target - today.getDay() + 7) % 7);
  const within = (target - weekStart + 7) % 7;
  return addDays(isoDay(startOfWeek(today, weekStart)), (reach === "next" ? 7 : -7) + within);
}

const UNITS: [RegExp, (n: number, today: Date) => string][] = [
  [/^d(?:ays?)?$/, (n, today) => addDays(isoDay(today), n)],
  [/^w(?:eeks?)?$/, (n, today) => addDays(isoDay(today), n * 7)],
  [
    /^months?$/,
    (n, today) => {
      // The same day of the month, or the last one when that month is shorter.
      const target = new Date(today.getFullYear(), today.getMonth() + n, 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      return dayText(target.getFullYear(), target.getMonth() + 1, Math.min(today.getDate(), last));
    },
  ],
];

/** The day a phrase without a time names, or null. */
function dayOf(phrase: string, today: Date, weekStart: number): string | null {
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(phrase);
  if (iso) return isRealDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? dayText(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null;

  const word = /^(?:(next|this|last)\s+)?([a-z]+)\.?$/.exec(phrase);
  if (word) {
    const [, how, typed] = word as unknown as [string, "next" | "this" | "last" | undefined, string];
    if (how && typed === "week" && how !== "this") return addDays(isoDay(startOfWeek(today, weekStart)), how === "next" ? 7 : -7);
    const target = weekdayOf(typed);
    if (target >= 0) return weekday(target, how === "next" ? "next" : how === "last" ? "last" : "upcoming", today, weekStart);
    // "today", "tomorrow" and "yesterday" stand alone.
    if (!how) {
      const offset = wordIndex(["yesterday", "today", "tomorrow"], typed);
      if (offset >= 0) return addDays(isoDay(today), offset - 1);
      if (typed === "tmrw" || typed === "tmr") return addDays(isoDay(today), 1);
    }
    return null;
  }

  const relative = /^in\s+(?:(\d+)\s*|(?:an?|one)\s+)([a-z]+)$/.exec(phrase);
  if (relative) {
    const n = relative[1] === undefined ? 1 : Number(relative[1]);
    const unit = UNITS.find(([pattern]) => pattern.test(relative[2]!));
    return unit && n <= 3650 ? unit[1](n, today) : null;
  }

  const ordinal = "(?:st|nd|rd|th)?";
  const monthFirst = new RegExp(`^([a-z]{3,9})\\.?\\s+(\\d{1,2})${ordinal}(?:\\s+(\\d{4}))?$`).exec(phrase);
  const dayFirst = monthFirst ? null : new RegExp(`^(\\d{1,2})${ordinal}\\s+(?:of\\s+)?([a-z]{3,9})\\.?(?:\\s+(\\d{4}))?$`).exec(phrase);
  const parts = monthFirst ? { name: monthFirst[1]!, day: monthFirst[2]!, year: monthFirst[3] } : dayFirst ? { name: dayFirst[2]!, day: dayFirst[1]!, year: dayFirst[3] } : null;
  if (parts) {
    const month = wordIndex(MONTHS, parts.name);
    return month < 0 ? null : monthDay(month + 1, Number(parts.day), parts.year === undefined ? null : Number(parts.year), today);
  }
  return null;
}

/** What `input` means as a day and time, or null when it is neither or
 * names a day that does not exist (`feb 30`, `2026-13-45`, `25:00`).
 *
 * A weekday alone (`fri`, `this fri`) is the first one on or after today;
 * `next fri` and `last fri` are that weekday in the week after or before
 * this one, as `next week` is the first day of next week. A month and day
 * without a year is the next one on or after today. */
export function parseWhen(input: string, options: WhenOptions = {}): When | null {
  const now = options.now ?? new Date();
  const weekStart = options.weekStart ?? 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let text = input.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim().replace(/^on /, "");
  if (!text) return null;

  let time: string | null = null;
  const tail = TRAILING.exec(text);
  const head = tail ? null : LEADING.exec(text);
  const clock = tail?.[1] ?? head?.[1];
  if (clock !== undefined) {
    time = clockTime(clock, now);
    if (time === null) return null;
    text = tail ? text.slice(0, tail.index).trim() : text.slice(head![0].length).trim();
  }
  if (!text) return time === null ? null : { day: isoDay(today), time, dated: false };
  const day = dayOf(text, today, weekStart);
  return day === null ? null : { day, time, dated: true };
}

/** The Markdown a page stores for `when`: the day as a link, then the time
 * as plain text (`[[2026-10-07]] 09:00`). */
export const whenMarkdown = (when: When) => `[[${when.day}]]${when.time ? ` ${when.time}` : ""}`;
