import type { NoteMeta } from "../../../lib/vault/types";
import { titleOf } from "../names";
import { projects } from "../tree";

/** In a project, or under another page, rather than loose in Pages or the
 * Inbox. A loose page's "Add to project" is in the top bar (TopBar.tsx). */
export const inProject = (note: NoteMeta) => Boolean(note.project || note.parent);

/** Where a page lives, in a word or two: its project, its parent page, or the library. */
export function placeLabel(note: NoteMeta, notes: readonly NoteMeta[]): string {
  if (note.parent) {
    const parent = notes.find((n) => n.id === note.parent);
    if (parent) return titleOf(parent);
  }
  if (note.project) {
    const project = projects(notes).find((p) => p.project === note.project);
    return project ? titleOf(project) : note.project;
  }
  return note.path.startsWith("inbox/") ? "Inbox" : "Library";
}
