// Projects through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/projects.rs).

import { invoke } from "@tauri-apps/api/core";

import { dayFrom } from "../dates";
import type { AppliedSetup, ProjectOps, ProjectSummary, SavedSetup, SetupGone, SetupInfo, SetupPlan, SetupSource } from "./project-types";
import type { NoteFile } from "./types";

export const tauriProjects: ProjectOps = {
  setProjectState: (path, change) => invoke<NoteFile>("set_project_state", { path, change }),
  projectSummaries: (today) => invoke<ProjectSummary[]>("project_summaries", { today: today ?? dayFrom() }),
  listSetups: () => invoke<SetupInfo[]>("list_setups"),
  previewSetup: (id, target) => invoke<SetupPlan>("preview_setup", { id, target }),
  applySetup: (id, target) => invoke<AppliedSetup>("apply_setup", { id, target }),
  previewProjectSetup: (project) => invoke<SetupSource>("preview_project_setup", { project }),
  saveProjectSetup: (project, title, pages, slug = "") => invoke<SavedSetup>("save_project_setup", { project, slug, title, pages }),
  renameSetup: (id, name) => invoke<SetupInfo>("rename_setup", { id, name }),
  trashSetup: (id) => invoke<SetupGone>("trash_setup", { id }),
};
