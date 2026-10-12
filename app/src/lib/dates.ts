// Days as Kasten names them: YYYY-MM-DD in local time, the journal's file names.

// Formatters made once: toLocaleDateString makes one per call, which is slow
// across the thousands of journal titles the palette and sidebar show.
const LONG_DAY = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function isoDay(date: Date): string {
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today, or `offset` days from it. */
export function dayFrom(offset = 0, now = new Date()): string {
  return isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
}

/** Whether year, month (1-12) and day name a day that exists, leap years included. */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** How many days `month` (1-12) of `year` has. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Whether `value` is `YYYY-MM-DD` and a day that exists on the calendar:
 * `2026-13-45` and `2026-02-29` are not. */
export function isDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match !== null && isRealDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** `day` moved by `days`. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  // setFullYear, as the Date constructor reads years 0 to 99 as 1900 to 1999.
  const date = new Date(2000, 0, 1);
  date.setFullYear(y!, m! - 1, d! + days);
  return isoDay(date);
}

/** A day as a local date at midnight; setFullYear, as the Date constructor
 * reads years 0 to 99 as 1900 to 1999. */
export function dateOf(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(2000, 0, 1);
  date.setFullYear(y!, m! - 1, d!);
  return date;
}

/** The first day of the week holding `date`, as the week starts on
 * `weekStart`: 1 Monday, 0 Sunday, 6 Saturday. */
export function startOfWeek(date: Date, weekStart: number): Date {
  const shift = (date.getDay() - weekStart + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - shift);
}

const utcDay = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** Whole days from `from` to `to` (negative when `to` comes first), whatever
 * the clocks do in between. */
export const daysBetween = (from: string, to: string) => Math.round((utcDay(to) - utcDay(from)) / 86_400_000);

const SHORT_DAY = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "Wed, Sep 23" for 2026-09-23. */
export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return SHORT_DAY.format(new Date(y, m - 1, d));
}

/** "Thursday, 24 September 2026" for a YYYY-MM-DD day. */
export function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return LONG_DAY.format(new Date(y, m - 1, d));
}

/** "24 Sep 2026" for a time stamp or a day: the day as written, whatever
 * the clock here says; "" for text that starts with no day. */
export function stampDay(stamp: string): string {
  const day = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(stamp);
  if (!day) return "";
  const date = new Date(2000, 0, 1);
  date.setFullYear(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  return SHORT_DATE.format(date);
}

/** "just now", "5 minutes ago", "yesterday", or a date. */
export function relativeTime(millis: number, now = Date.now()): string {
  const seconds = Math.round((now - millis) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return SHORT_DATE.format(new Date(millis));
}
