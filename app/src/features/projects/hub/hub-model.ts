// What the Projects hub works out from the project summaries: the figures on a
// card, which projects a filter keeps, the order they are shown in and the
// small counts above the list. Pure, so it is easy to test and cheap to rerun.

import type { ProjectSummary } from "../../../lib/vault/project-types";
import type { Arrangement } from "../../workspace/project-order";

export type StatusFilter = "all" | "active" | "paused" | "done";
/** A look at what needs attention, chosen from the counts above the list. */
export type Focus = "overdue" | "review" | "stale";
export type SortId = "manual" | "recent" | "name" | "overdue";
export type HubLayout = "gallery" | "list";

export const STATUS_FILTERS: readonly { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "done", label: "Done" },
];

export const SORTS: readonly { id: SortId; label: string }[] = [
  { id: "manual", label: "Pinned first, your order" },
  { id: "recent", label: "Recently active" },
  { id: "name", label: "Name" },
  { id: "overdue", label: "Overdue first" },
];

export const isStatusFilter = (value: unknown): value is StatusFilter => STATUS_FILTERS.some((f) => f.id === value);
export const isSort = (value: unknown): value is SortId => SORTS.some((s) => s.id === value);
export const isLayout = (value: unknown): value is HubLayout => value === "gallery" || value === "list";

export interface HubQuery {
  status: StatusFilter;
  /** Show the archived projects, and only them. */
  archived: boolean;
  focus: Focus | null;
  text: string;
}

/** Days without a change after which an active project counts as stale. */
export const STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** To-dos still open: the project's `#task` notes and its checklist lines together. */
export const openOf = (s: ProjectSummary): number => s.tasks.open + s.checklist.open;
/** Open to-dos whose day has passed. */
export const overdueOf = (s: ProjectSummary): number => s.tasks.overdue + s.checklist.overdue;

/** How far the to-dos are done, counting both kinds the way `openOf` does. */
export function progressOf(s: ProjectSummary): { done: number; total: number; percent: number } {
  const done = s.tasks.done + s.checklist.done;
  const total = done + openOf(s);
  return { done, total, percent: total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100)) };
}

/** An active project nobody has touched for 30 days. Paused, finished and
 * archived projects are meant to be quiet, and one with nothing in it yet has
 * nothing to go stale. */
export function isStale(s: ProjectSummary, now: number): boolean {
  if (s.archived || s.status !== "Active" || s.latest === null) return false;
  return now - s.latest.modified > STALE_DAYS * DAY_MS;
}

const WANTS: Record<Exclude<StatusFilter, "all">, ProjectSummary["status"]> = { active: "Active", paused: "Paused", done: "Done" };

/** The projects a query keeps, in the order given. */
export function filterProjects(list: readonly ProjectSummary[], query: HubQuery, now: number): ProjectSummary[] {
  const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((s) => {
    if (s.archived !== query.archived) return false;
    if (query.status !== "all" && s.status !== WANTS[query.status]) return false;
    if (query.focus === "overdue" && overdueOf(s) === 0) return false;
    if (query.focus === "review" && !s.reviewDue) return false;
    if (query.focus === "stale" && !isStale(s, now)) return false;
    if (words.length === 0) return true;
    const hay = `${s.title}\n${s.summary ?? ""}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const byTitle = (a: ProjectSummary, b: ProjectSummary) => collator.compare(a.title, b.title) || collator.compare(a.path, b.path);
const touched = (s: ProjectSummary) => s.latest?.modified ?? 0;

/** The sidebar's arrangement: pinned projects first, each group in the order
 * the person dragged, projects nobody arranged after those, by title. */
function arranged(list: readonly ProjectSummary[], prefs: Arrangement): ProjectSummary[] {
  const rank = new Map<string, number>();
  prefs.projectOrder.forEach((folder, i) => {
    if (!rank.has(folder)) rank.set(folder, i);
  });
  const placed = list.filter((s) => rank.has(s.folder)).sort((a, b) => rank.get(a.folder)! - rank.get(b.folder)! || byTitle(a, b));
  const fresh = list.filter((s) => !rank.has(s.folder)).sort(byTitle);
  const all = [...placed, ...fresh];
  const pins = new Set(prefs.pinnedProjects);
  return [...all.filter((s) => pins.has(s.folder)), ...all.filter((s) => !pins.has(s.folder))];
}

/** A copy of `list` in the order asked for. Only "manual" lets pins and the dragged order count. */
export function sortProjects(list: readonly ProjectSummary[], sort: SortId, prefs: Arrangement): ProjectSummary[] {
  if (sort === "manual") return arranged(list, prefs);
  const copy = [...list];
  if (sort === "recent") return copy.sort((a, b) => touched(b) - touched(a) || byTitle(a, b));
  if (sort === "overdue") return copy.sort((a, b) => overdueOf(b) - overdueOf(a) || byTitle(a, b));
  return copy.sort(byTitle);
}

export interface HubStats {
  /** Projects whose status is Active. */
  active: number;
  /** Open to-dos past their day, in projects not yet done. */
  overdue: number;
  /** How many projects those are in. */
  projectsOverdue: number;
  /** Projects whose review day has come. */
  reviews: number;
  stale: number;
}

/** The counts above the list; archived projects do not count. */
export function hubStats(list: readonly ProjectSummary[], now: number): HubStats {
  const stats: HubStats = { active: 0, overdue: 0, projectsOverdue: 0, reviews: 0, stale: 0 };
  for (const s of list) {
    if (s.archived) continue;
    if (s.status === "Active") stats.active++;
    if (s.status !== "Done" && overdueOf(s) > 0) {
      stats.overdue += overdueOf(s);
      stats.projectsOverdue++;
    }
    if (s.reviewDue) stats.reviews++;
    if (isStale(s, now)) stats.stale++;
  }
  return stats;
}

/** How many projects each status chip would show, among the archived or the unarchived ones. */
export function statusCounts(list: readonly ProjectSummary[], archived: boolean): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: 0, active: 0, paused: 0, done: 0 };
  for (const s of list) {
    if (s.archived !== archived) continue;
    counts.all++;
    if (s.status === "Active") counts.active++;
    else if (s.status === "Paused") counts.paused++;
    else if (s.status === "Done") counts.done++;
  }
  return counts;
}
