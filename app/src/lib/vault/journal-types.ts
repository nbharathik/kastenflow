// A project's journal: one note per project per day at
// `projects/<project>/journal/<year>/<date>.md`. The shapes of the window's
// commands in app/src-tauri/src/commands/journals.rs.

import type { DraftRule } from "./draft-rule";
import type { NoteFile } from "./note-types";

/** A project's day that has a note, for the main journal's strip. */
export interface ProjectJournalRef {
  /** The project's folder name. */
  project: string;
  projectTitle: string;
  /** The day's note. */
  path: string;
  date: string;
}

/** One day in a project's journal list. */
export interface ProjectJournalDay {
  date: string;
  path: string;
  excerpt: string;
  words: number;
  modified: number;
}

/** A page of a project's journal days, newest first. */
export interface ProjectJournalPage {
  project: string;
  projectTitle: string;
  total: number;
  days: ProjectJournalDay[];
}

export interface JournalOps {
  /** Adds markdown to the end of a day (under `heading` when given) in one commit, making the day if it is new. Without `project` it is the vault's own journal. */
  journalAppend(date: string, markdown: string, heading?: string | null, project?: string | null): Promise<NoteFile>;
  /** The projects that have a journal note on `date`. */
  projectJournalsOn(date: string): Promise<ProjectJournalRef[]>;
  /** The days of one project's journal, newest first (`limit` is at most 200). */
  projectJournalDays(project: string, limit?: number, offset?: number): Promise<ProjectJournalPage>;
}

/** What a call about a draft does, for each call of `JournalOps`. */
export const JOURNAL_RULES = {
  journalAppend: "pass",
  projectJournalsOn: "pass",
  projectJournalDays: "pass",
} as const satisfies Record<keyof JournalOps, DraftRule>;
