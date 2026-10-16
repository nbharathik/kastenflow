// What a daily or weekly review shows, worked out from what the window
// already has: the note list, the to-dos the index found, the projects'
// summaries. Pure and read-only: assembling a review writes nothing and makes
// nothing; the screen asks for a note only when told to.

import { addDays, dateOf, isDay, isoDay, longDay, shortDay } from "../../lib/dates";
import type { ProjectSummary } from "../../lib/vault/project-types";
import type { NoteMeta, TaskRow } from "../../lib/vault/types";
import { whenRange } from "../collections/run";
import { queueOf } from "../inbox/queue";
import { titleOf } from "../workspace/names";

export type ReviewKind = "daily" | "weekly";

export interface ReviewPeriod {
  kind: ReviewKind;
  /** The first and last day, both included. */
  from: string;
  to: string;
  today: string;
}

/** The days a review looks back over: today, or the last seven days as the collections count them. */
export function periodOf(kind: ReviewKind, today: string): ReviewPeriod {
  if (kind === "daily") return { kind, from: today, to: today, today };
  const { from, to } = whenRange("last-7-days", today);
  return { kind, from, to, today };
}

/** The period in words: "Sunday, 11 October 2026" or "4 Oct to 11 Oct". */
export function periodWords(period: ReviewPeriod): string {
  return period.kind === "daily" ? longDay(period.to) : `${shortDay(period.from)} to ${shortDay(period.to)}`;
}

/** A to-do line or a `task` note that is due. */
export interface DueItem {
  key: string;
  kind: "todo" | "task";
  text: string;
  /** The page it is in, or the task's project. */
  where: string;
  due: string;
  path: string;
}

export interface Review {
  /** Cards waiting for triage: the Inbox and unfiled captures, less those put off or filed. */
  captures: { count: number; items: NoteMeta[] };
  overdue: DueItem[];
  /** Due today (daily), or from today through the next seven days (weekly). */
  due: DueItem[];
  /** Projects whose review day has come. */
  projects: ProjectSummary[];
  /** Notes tagged `decision` made or edited in the period. */
  decisions: NoteMeta[];
  /** Task notes marked Done and changed in the period. */
  completed: NoteMeta[];
  /** A few highlights not touched for a while, the same ones all day. */
  highlights: NoteMeta[];
  /** Nothing at all to show. */
  empty: boolean;
}

export interface ReviewInput {
  period: ReviewPeriod;
  notes: readonly NoteMeta[];
  /** The to-dos in pages (`- [ ]` lines); null while they are being read. */
  tasks: readonly TaskRow[] | null;
  /** The projects' summaries; null while they are being read. */
  projects: readonly ProjectSummary[] | null;
}

/** Captures listed before "and N more". */
export const CAPTURES_SHOWN = 5;
/** Highlights offered, and how long one must have been left alone to be offered. */
export const HIGHLIGHTS_SHOWN = 3;
export const REVISIT_AFTER_DAYS = 14;

const hasTag = (note: NoteMeta, tag: string) => note.tags.some((t) => t.toLowerCase() === tag);
const dayOfTime = (millis: number) => isoDay(new Date(millis));
const within = (day: string, period: ReviewPeriod) => day >= period.from && day <= period.to;
const dayOfString = (value: string | null): string | null => (value && isDay(value.slice(0, 10)) ? value.slice(0, 10) : null);

/** The day a note was last made or edited: its own `updated`, else `created`, else its file's time. */
function touched(note: NoteMeta): string {
  return dayOfString(note.updated) ?? dayOfString(note.created) ?? dayOfTime(note.modified);
}

const isDone = (note: NoteMeta) => typeof note.props.status === "string" && note.props.status.trim().toLowerCase() === "done";

function taskNotes(notes: readonly NoteMeta[]): NoteMeta[] {
  return notes.filter((n) => n.kind !== "template" && hasTag(n, "task"));
}

/** A to-do's words without the day it names (`@2026-10-02`, `@2026-10-02 09:00`, `📅 2026-10-02`): the review shows the day beside it. */
export function todoText(text: string): string {
  return text
    .replace(/\s*@\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?/g, "")
    .replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dueItems(notes: readonly NoteMeta[], tasks: readonly TaskRow[] | null): DueItem[] {
  const items: DueItem[] = [];
  for (const row of tasks ?? []) {
    if (row.done || !row.due || row.path.startsWith("templates/")) continue;
    items.push({ key: `todo:${row.path}:${row.line}`, kind: "todo", text: todoText(row.text) || row.text, where: row.title, due: row.due, path: row.path });
  }
  for (const note of taskNotes(notes)) {
    const due = typeof note.props.due === "string" && isDay(note.props.due.trim()) ? note.props.due.trim() : null;
    if (isDone(note) || !due) continue;
    items.push({ key: `task:${note.path}`, kind: "task", text: titleOf(note), where: note.project ?? "", due, path: note.path });
  }
  return items.sort((a, b) => a.due.localeCompare(b.due) || (a.kind === b.kind ? a.text.localeCompare(b.text) : a.kind === "todo" ? -1 : 1));
}

/** Up to three highlights left alone for two weeks, picked from the day so they change daily and not on every look. */
function highlightsToRevisit(notes: readonly NoteMeta[], today: string): NoteMeta[] {
  const cutoff = addDays(today, -REVISIT_AFTER_DAYS);
  const old = notes.filter((n) => n.kind === "highlight" && dayOfTime(n.modified) <= cutoff).sort((a, b) => a.path.localeCompare(b.path));
  if (old.length <= HIGHLIGHTS_SHOWN) return old;
  const seed = [...today].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: HIGHLIGHTS_SHOWN }, (_, i) => old[(seed + i) % old.length]!);
}

export function assembleReview({ period, notes, tasks, projects }: ReviewInput): Review {
  const { today } = period;
  const queue = queueOf(notes, today);
  const items = dueItems(notes, tasks);
  const ahead = period.kind === "daily" ? today : addDays(today, 7);
  const overdue = items.filter((i) => i.due < today);
  const due = items.filter((i) => i.due >= today && i.due <= ahead);
  const toReview = projects?.filter((p) => p.reviewDue && !p.archived) ?? [];
  const decisions = notes
    .filter((n) => n.kind !== "template" && hasTag(n, "decision") && within(touched(n), period))
    .sort((a, b) => touched(b).localeCompare(touched(a)) || a.path.localeCompare(b.path));
  const completed = taskNotes(notes)
    .filter((n) => isDone(n) && within(dayOfTime(n.modified), period))
    .sort((a, b) => b.modified - a.modified);
  const highlights = highlightsToRevisit(notes, today);
  const review: Review = {
    captures: { count: queue.length, items: queue.slice(0, CAPTURES_SHOWN) },
    overdue,
    due,
    projects: toReview,
    decisions,
    completed,
    highlights,
    empty: false,
  };
  review.empty = queue.length + overdue.length + due.length + toReview.length + decisions.length + completed.length + highlights.length === 0;
  return review;
}

/** A day as the review words it: "today", "yesterday", or the date. */
export function dayWords(day: string, today: string): string {
  if (day === today) return "today";
  if (day === addDays(today, -1)) return "yesterday";
  if (day === addDays(today, 1)) return "tomorrow";
  return dateOf(day).getFullYear() === dateOf(today).getFullYear() ? shortDay(day) : longDay(day);
}
