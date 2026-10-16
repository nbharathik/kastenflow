// The short phrases a project card and row are made of. Pure.

import type { ProjectSummary } from "../../../lib/vault/project-types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const SAME_YEAR = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const OTHER_YEAR = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** "just now", "5 min ago", "2 h ago", "yesterday", "3 days ago", then the date. */
export function agoShort(modified: number, now: number): string {
  const ms = Math.max(0, now - modified);
  if (ms < 45_000) return "just now";
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min ago`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h ago`;
  const days = Math.round(ms / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const then = new Date(modified);
  return (then.getFullYear() === new Date(now).getFullYear() ? SAME_YEAR : OTHER_YEAR).format(then);
}

/** "edited 2 h ago · Pitch deck": when the newest thing in the project changed, and what it was. */
export function activityText(latest: ProjectSummary["latest"], now: number): string {
  if (!latest) return "No activity yet";
  const title = latest.title.trim();
  return `edited ${agoShort(latest.modified, now)}${title ? ` · ${title}` : ""}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 pages · 2 boards · 1 deck": what the project holds, leaving out what is none. */
export function contentsText(s: Pick<ProjectSummary, "notes" | "boards" | "decks">): string {
  const parts = [s.notes ? plural(s.notes, "page") : "", s.boards ? plural(s.boards, "board") : "", s.decks ? plural(s.decks, "deck") : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Nothing in it yet";
}
