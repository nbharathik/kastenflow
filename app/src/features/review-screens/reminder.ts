// When the weekly reminder shows, and how "no review since" is worded. A
// review that was not done is never an error or a count of failures: it is a
// date, said once, quietly.

import { addDays, dateOf, daysBetween } from "../../lib/dates";
import { dayWords, type ReviewKind } from "./assemble";
import type { ReviewPrefs } from "./review-prefs";

/** The most recent day, today included, that falls on `weekday` (0 Sunday to 6 Saturday). */
export function reminderDay(today: string, weekday: number): string {
  return addDays(today, -((dateOf(today).getDay() - weekday + 7) % 7));
}

/** The reminder shows when it is on, its weekday has come, no weekly review
 * has been marked since that day, and it was not put off today. */
export function reminderDue(prefs: Pick<ReviewPrefs, "remind" | "weekday" | "last" | "snoozed">, today: string): boolean {
  if (!prefs.remind || prefs.snoozed === today) return false;
  const since = prefs.last.weekly;
  return since === null || since < reminderDay(today, prefs.weekday);
}

/** Days after which a review of this kind counts as not done lately. */
const GAP: Record<ReviewKind, number> = { daily: 1, weekly: 7 };

/** What the screen says about the last review of a kind: when it was, or that there has been none since a day. */
export function lastLine(kind: ReviewKind, last: string | null, today: string): string {
  if (last === null) return `No ${kind} review yet`;
  if (last === today) return `The ${kind} review is marked done for today`;
  return daysBetween(last, today) >= GAP[kind] ? `No ${kind} review since ${dayWords(last, today)}` : `Last ${kind} review: ${dayWords(last, today)}`;
}
