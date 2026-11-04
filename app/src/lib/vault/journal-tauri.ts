// A project's journal through Tauri commands (app/src-tauri/src/commands/journals.rs).

import { invoke } from "@tauri-apps/api/core";

import type { JournalOps, ProjectJournalPage, ProjectJournalRef } from "./journal-types";
import type { NoteFile } from "./note-types";

export const tauriJournals: JournalOps = {
  journalAppend: (date, markdown, heading, project) => invoke<NoteFile>("journal_append", { date, markdown, heading: heading ?? null, project: project ?? null }),
  projectJournalsOn: (date) => invoke<ProjectJournalRef[]>("project_journals_on", { date }),
  projectJournalDays: (project, limit, offset) => invoke<ProjectJournalPage>("project_journal_days", { project, limit: limit ?? null, offset: offset ?? null }),
};
