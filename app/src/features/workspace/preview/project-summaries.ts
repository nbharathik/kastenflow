// Project summaries for the browser preview: the same fields kasten-core's
// `project_summaries` returns (index/projects.rs), worked out from the notes
// the preview holds. Pure.

import type { BoardInfo, DeckInfo, NoteMeta } from "../../../lib/vault/types";
import { PROJECT_HEALTHS, PROJECT_STATUSES, type ProjectSummary, type TaskCounts } from "../../../lib/vault/project-types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { tasksIn } from "../tasks";
import { dueAt } from "./day-times";

export interface SummaryInput {
  notes: readonly NoteMeta[];
  /** The text of the note at a path. */
  textOf(path: string): string;
  boards: readonly BoardInfo[];
  decks: readonly DeckInfo[];
  /** The person's day, `YYYY-MM-DD`. */
  today: string;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const day = (value: unknown): string | null => {
  const found = text(value);
  return found && /^\d{4}-\d{2}-\d{2}/.test(found) ? found.slice(0, 10) : null;
};
const has = (tags: readonly string[], tag: string) => tags.some((t) => t.toLowerCase() === tag);
const counts = (): TaskCounts => ({ open: 0, done: 0, overdue: 0 });

/** The status a project page names; a page that names none is Active. */
export function statusOf(props: Record<string, unknown>): ProjectSummary["status"] {
  const value = text(props.status);
  if (value === null) return "Active";
  return PROJECT_STATUSES.find((s) => s.toLowerCase() === value.toLowerCase()) ?? "Other";
}

export function healthOf(props: Record<string, unknown>): ProjectSummary["health"] {
  const value = text(props.health);
  if (value === null) return null;
  return PROJECT_HEALTHS.find((h) => h.toLowerCase() === value.toLowerCase()) ?? "Other";
}

export const isArchived = (props: Record<string, unknown>) => props.archived === true || (typeof props.archived === "string" && props.archived.trim().toLowerCase() === "true");

export function summarise({ notes, textOf, boards, decks, today }: SummaryInput): ProjectSummary[] {
  const byFolder = new Map<string, NoteMeta[]>();
  for (const note of notes) {
    if (note.kind === "template" || !note.project) continue;
    const list = byFolder.get(note.project);
    if (list) list.push(note);
    else byFolder.set(note.project, [note]);
  }
  const byId = new Map(notes.filter((n) => n.id).map((n) => [n.id!, n]));
  const out: ProjectSummary[] = [];
  for (const page of notes) {
    if (page.kind !== "project" || !page.project || page.path !== `projects/${page.project}/_project.md`) continue;
    const folder = page.project;
    const inside = byFolder.get(folder) ?? [];
    const others = inside.filter((n) => n.path !== page.path);
    const props = page.props;
    const archived = isArchived(props);
    const status = statusOf(props);
    const tasks = counts();
    for (const note of others.filter((n) => has(n.tags, "task"))) {
      const done = text(note.props.status)?.toLowerCase() === "done";
      const due = day(note.props.due);
      if (done) tasks.done++;
      else {
        tasks.open++;
        if (due !== null && due < today) tasks.overdue++;
      }
    }
    const checklist = counts();
    for (const note of inside) {
      for (const item of tasksIn(splitFrontmatter(textOf(note.path)).body)) {
        if (item.done) checklist.done++;
        else {
          checklist.open++;
          const due = dueAt(item.text)?.day;
          if (due && due < today) checklist.overdue++;
        }
      }
    }
    const ownBoards = boards.filter((b) => b.project === folder);
    const ownDecks = decks.filter((d) => d.project === folder);
    const newest = [...inside].sort((a, b) => b.modified - a.modified)[0];
    const updates = others
      .filter((n) => has(n.tags, "project-update"))
      .map((n) => ({ note: n, date: day(n.props.date) ?? day(n.created) }))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.note.modified - a.note.modified);
    const nextId = text(props.next_action);
    const next = nextId ? byId.get(nextId) : undefined;
    const reviewAfter = day(props.review_after);
    out.push({
      path: page.path,
      folder,
      id: page.id,
      title: page.title,
      icon: page.icon,
      summary: text(props.summary),
      archived,
      status,
      health: healthOf(props),
      nextAction: next?.id ? { id: next.id, path: next.path, title: next.title, done: text(next.props.status)?.toLowerCase() === "done" } : null,
      lastReview: day(props.last_review),
      reviewAfter,
      reviewDue: reviewAfter !== null && reviewAfter <= today && status !== "Done" && !archived,
      tasks,
      checklist,
      latest: newest ? { modified: newest.modified, path: newest.path, title: newest.title, kind: newest.kind } : null,
      lastUpdate: updates[0] ? { path: updates[0].note.path, title: updates[0].note.title, date: updates[0].date } : null,
      notes: others.length,
      boards: ownBoards.length,
      decks: ownDecks.length,
    });
  }
  return out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.path.localeCompare(b.path));
}
