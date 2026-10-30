// Asking for the "Save as a setup" dialog: from a project's menus and the
// palette. The dialog (SaveSetup.tsx) loads when a request is made.

import { create } from "zustand";

import { useWorkspace } from "../../workspace/store";
import { currentProject } from "../overview/open";

interface SaveSetupRequestState {
  /** The dialog is wanted; `project` is the folder under `projects/` to start on, none to choose. */
  request: { project: string | null } | null;
  ask(project?: string | null): void;
  close(): void;
}

export const useSaveSetupRequest = create<SaveSetupRequestState>()((set) => ({
  request: null,
  ask: (project = null) => set({ request: { project } }),
  close: () => set({ request: null }),
}));

/** Asks for the dialog, on this project when it is given. */
export const askToSaveSetup = (project?: string | null): void => useSaveSetupRequest.getState().ask(project);

/** The palette's "Save project as a setup…": the project of where the person is, else the dialog asks which. */
export function saveCurrentProjectAsSetup(): void {
  const { place, notes } = useWorkspace.getState();
  askToSaveSetup(currentProject(place, notes)?.project ?? null);
}
