// What triage works through: the cards waiting in the Inbox and the captures
// (cards tagged `capture`) nobody has filed in a project, newest first, less
// those put off until a later day and those already filed. Leaving the queue
// is a property of the card (`review_after`, a capture's `status`), never a
// folder of its own, so a card put off comes back by itself on its day and a
// hand edit of the file means the same thing.

import { addDays, dateOf, daysInMonth, isDay, isoDay } from "../../lib/dates";
import type { NoteMeta } from "../../lib/vault/types";
import { caughtAt } from "../workspace/capture";
import { whenRange } from "../collections/run";
import { inboxCards } from "../workspace/tree";

/** The tag the browser tab and the extension give what they save (the overview's Captures tab says the same). */
export const CAPTURE_TAG = "capture";

/** The property a card put off carries: the day it comes back, `YYYY-MM-DD`. */
export const REVIEW_AFTER = "review_after";

/** The `capture` tag's status that says a capture has been dealt with. */
export const FILED = "Filed";

/** The `capture` tag's reading states. */
export const READING_STATES = ["Unread", "Reading", "Finished"] as const;
export type Reading = (typeof READING_STATES)[number];

/** How far "later" can be, in the words of the keys. */
export type Later = "tomorrow" | "week" | "month";

const hasTag = (note: NoteMeta, tag: string) => note.tags.some((t) => t.toLowerCase() === tag);

/** A card tagged `capture`. */
export const isCapture = (note: NoteMeta): boolean => note.kind === "card" && hasTag(note, CAPTURE_TAG);

/** A capture whose `status` says it was filed. */
export const isFiled = (note: NoteMeta): boolean => isCapture(note) && typeof note.props.status === "string" && note.props.status.trim().toLowerCase() === FILED.toLowerCase();

/** The day the card was put off to, when it has a real one. */
export function deferredUntil(note: Pick<NoteMeta, "props">): string | null {
  const day = note.props[REVIEW_AFTER];
  return typeof day === "string" && isDay(day.trim()) ? day.trim() : null;
}

/** Put off past `today`: it comes back on its day, not before. */
export const isDeferred = (note: NoteMeta, today: string): boolean => {
  const until = deferredUntil(note);
  return until !== null && until > today;
};

/** Whether the card waits for triage today. */
export const inQueue = (note: NoteMeta, today: string): boolean => !isFiled(note) && !isDeferred(note, today);

const newestFirst = (a: NoteMeta, b: NoteMeta) => caughtAt(b) - caughtAt(a) || a.path.localeCompare(b.path);

/** The cards in the Inbox, and the captures in no project. */
function candidates(notes: readonly NoteMeta[]): NoteMeta[] {
  const waiting = new Map<string, NoteMeta>();
  for (const card of inboxCards(notes)) waiting.set(card.path, card);
  for (const note of notes) if (isCapture(note) && !note.project) waiting.set(note.path, note);
  return [...waiting.values()].filter((n) => n.kind !== "template");
}

/** The cards triage goes through today, newest first. */
export function queueOf(notes: readonly NoteMeta[], today: string): NoteMeta[] {
  return candidates(notes)
    .filter((n) => inQueue(n, today))
    .sort(newestFirst);
}

/** The cards put off to a later day, the soonest to return first. */
export function deferredFrom(notes: readonly NoteMeta[], today: string): NoteMeta[] {
  return candidates(notes)
    .filter((n) => !isFiled(n) && isDeferred(n, today))
    .sort((a, b) => deferredUntil(a)!.localeCompare(deferredUntil(b)!) || newestFirst(a, b));
}

/** The cards caught in the last seven days, as the collections count them
 * (the seven days before today, and today), by the person's own clock. */
export function caughtThisWeek<T extends Pick<NoteMeta, "created" | "modified">>(cards: readonly T[], today: string): T[] {
  const { from, to } = whenRange("last-7-days", today);
  return cards.filter((card) => {
    const day = isoDay(new Date(caughtAt(card)));
    return day >= from && day <= to;
  });
}

/** The day a card is put off to. A month on keeps the day of the month, or
 * the month's last day when the next month is shorter. */
export function laterDay(choice: Later, today: string): string {
  if (choice === "tomorrow") return addDays(today, 1);
  if (choice === "week") return addDays(today, 7);
  const date = dateOf(today);
  const month = date.getMonth() + 1;
  const [year, next] = month === 12 ? [date.getFullYear() + 1, 1] : [date.getFullYear(), month + 1];
  return `${String(year).padStart(4, "0")}-${String(next).padStart(2, "0")}-${String(Math.min(date.getDate(), daysInMonth(year, next))).padStart(2, "0")}`;
}

/** A card's reading state, if it names one of the three. */
export function readingOf(note: Pick<NoteMeta, "props">): Reading | null {
  const state = note.props.reading;
  return typeof state === "string" ? (READING_STATES.find((s) => s.toLowerCase() === state.trim().toLowerCase()) ?? null) : null;
}

/** The state one press of the reading key moves to: nothing, then each in turn, then nothing again. */
export function nextReading(now: Reading | null): Reading | null {
  if (now === null) return READING_STATES[0];
  return READING_STATES[READING_STATES.indexOf(now) + 1] ?? null;
}
