// Fixtures for the Projects hub's tests: a project's summary as the core
// returns it, and its page as the note list holds it.

import type { ProjectSummary } from "../../../lib/vault/project-types";
import type { NoteMeta } from "../../../lib/vault/types";

/** The moment the tests call now. */
export const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const TODAY = "2026-10-11";

const title = (folder: string) => folder.charAt(0).toUpperCase() + folder.slice(1).replace(/-/g, " ");

/** A project that is Active, quiet and empty; `over` changes what a test is about. */
export function summary(folder: string, over: Partial<ProjectSummary> = {}): ProjectSummary {
  const path = `projects/${folder}/_project.md`;
  return {
    path,
    folder,
    id: folder,
    title: title(folder),
    icon: null,
    summary: null,
    archived: false,
    status: "Active",
    health: null,
    nextAction: null,
    lastReview: null,
    reviewAfter: null,
    reviewDue: false,
    tasks: { open: 0, done: 0, overdue: 0 },
    checklist: { open: 0, done: 0, overdue: 0 },
    latest: { modified: NOW - 2 * HOUR, path: `projects/${folder}/pages/Notes.md`, title: "Notes", kind: "page" },
    lastUpdate: null,
    notes: 0,
    boards: 0,
    decks: 0,
    ...over,
  };
}

/** The newest thing in a project, `ms` before now. */
export const at = (ms: number) => ({ modified: NOW - ms, path: "p", title: "Notes", kind: "page" });

/** A few projects the component tests share. */
export const photos = summary("photos", {
  title: "Photo organiser",
  summary: "Sort and back up the library",
  health: "At risk",
  tasks: { open: 2, done: 1, overdue: 1 },
  checklist: { open: 1, done: 4, overdue: 1 },
  reviewDue: true,
  reviewAfter: "2026-10-01",
  nextAction: { id: "t1", path: "projects/photos/cards/Write importer.md", title: "Write importer", done: false },
  notes: 12,
  boards: 2,
  decks: 1,
  latest: { modified: NOW - 2 * HOUR, path: "p", title: "Pitch deck", kind: "deck" },
});
export const trip = summary("trip", { title: "Trip", status: "Paused", latest: at(3 * DAY) });
export const taxes = summary("taxes", { title: "Taxes", status: "Done", latest: at(40 * DAY) });
export const garden = summary("garden", { title: "Garden", latest: at(90 * DAY) });
export const old = summary("old", { title: "Old plans", archived: true });

/** The project's page as the note list holds it. */
export function projectNote(folder: string, name = title(folder), over: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path: `projects/${folder}/_project.md`,
    id: folder,
    title: name,
    kind: "project",
    icon: null,
    cover: null,
    parent: null,
    project: folder,
    tags: [],
    modified: 1,
    created: null,
    updated: null,
    excerpt: "",
    words: 0,
    props: {},
    locked: false,
    ...over,
  };
}
