// The checks `set_project_state` makes (kasten-core engine/projects.rs), for
// the browser preview: fixed vocabularies, real days, and a next action that
// is a `task` note.

import { PROJECT_HEALTHS, PROJECT_STATUSES, type ProjectStateChange } from "../../../lib/vault/project-types";
import type { NoteMeta } from "../../../lib/vault/types";
import { isRealDay } from "./day-times";

/** The property each key of a change is stored under; `null` removes it. */
export function stateProps(change: ProjectStateChange): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const word = (key: string, value: string | null | undefined, allowed: readonly string[], label: string) => {
    if (value === undefined) return;
    if (value === null) {
      out[key] = null;
      return;
    }
    const found = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
    if (!found) throw new Error(`A project's ${label} is one of: ${allowed.join(", ")}`);
    out[key] = found;
  };
  const date = (key: string, value: string | null | undefined, label: string) => {
    if (value === undefined) return;
    if (value !== null && !isRealDay(value.trim())) throw new Error(`The ${label} is a day written YYYY-MM-DD`);
    out[key] = value === null ? null : value.trim();
  };
  word("status", change.status, PROJECT_STATUSES, "status");
  word("health", change.health, PROJECT_HEALTHS, "health");
  date("last_review", change.reviewed, "last review");
  date("review_after", change.reviewAfter, "next review");
  return out;
}

/** The task note a reference names: its path, id or (unique) title. */
export function findTask(notes: readonly NoteMeta[], reference: string): NoteMeta {
  const wanted = reference.trim();
  const tasks = notes.filter((n) => n.kind !== "template" && n.tags.some((t) => t.toLowerCase() === "task"));
  const found = tasks.find((n) => n.path === wanted) ?? tasks.find((n) => n.id === wanted);
  if (found) return found;
  const titled = tasks.filter((n) => n.title.toLowerCase() === wanted.toLowerCase());
  if (titled.length === 1) return titled[0]!;
  if (titled.length > 1) throw new Error(`Several tasks are called “${wanted}”; name one by path: ${titled.map((n) => n.path).join(", ")}`);
  throw new Error(`“${wanted}” is not a task note: a project's next action is a note tagged #task`);
}
