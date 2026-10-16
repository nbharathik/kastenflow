// A project as the review pieces need to know it: where its page is and the
// three things they change (its next action, the day it was last reviewed and
// the day it is next due), read from a hub summary or from the project's page.

import type { ProjectSummary } from "../../../lib/vault/project-types";
import type { NoteMeta } from "../../../lib/vault/types";

export interface ProjectRef {
  /** The project page, `projects/<folder>/_project.md`. */
  path: string;
  title: string;
  /** The folder under `projects/`. */
  folder: string;
  /** The id of the task note it does next, as the page stores it. */
  nextActionId: string | null;
  lastReview: string | null;
  reviewAfter: string | null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

export function refOfSummary(s: ProjectSummary): ProjectRef {
  return { path: s.path, title: s.title, folder: s.folder, nextActionId: s.nextAction?.id ?? null, lastReview: s.lastReview, reviewAfter: s.reviewAfter };
}

/** From the project page's own properties (`next_action`, `last_review`, `review_after`). */
export function refOfNote(note: Pick<NoteMeta, "path" | "title" | "props" | "project">): ProjectRef {
  return {
    path: note.path,
    title: note.title,
    folder: note.project ?? /^projects\/([^/]+)\//.exec(note.path)?.[1] ?? "",
    nextActionId: text(note.props.next_action),
    lastReview: text(note.props.last_review),
    reviewAfter: text(note.props.review_after),
  };
}
