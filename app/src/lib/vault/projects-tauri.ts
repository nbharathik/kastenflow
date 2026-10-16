// Projects through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/projects.rs).

import { invoke } from "@tauri-apps/api/core";

import { dayFrom } from "../dates";
import type { AppliedSetup, ProjectOps, ProjectSummary, SetupInfo, SetupPlan } from "./project-types";
import type { NoteFile } from "./types";

export const tauriProjects: ProjectOps = {
  setProjectState: (path, change) => invoke<NoteFile>("set_project_state", { path, change }),
  projectSummaries: (today) => invoke<ProjectSummary[]>("project_summaries", { today: today ?? dayFrom() }),
  listSetups: () => invoke<SetupInfo[]>("list_setups"),
  previewSetup: (id, target) => invoke<SetupPlan>("preview_setup", { id, target }),
  applySetup: (id, target) => invoke<AppliedSetup>("apply_setup", { id, target }),
};
