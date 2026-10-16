// Asking for the export dialog: from a project's card or row, the palette and
// Settings. The dialog (ExportProject.tsx) loads when a request is made.

import { create } from "zustand";

import { useWorkspace } from "../../workspace/store";
import { currentProject } from "../overview/open";

interface ExportRequestState {
  /** The dialog is wanted; `project` is the folder under `projects/` to start on, none to choose. */
  request: { project: string | null } | null;
  ask(project?: string | null): void;
  close(): void;
}

export const useExportRequest = create<ExportRequestState>()((set) => ({
  request: null,
  ask: (project = null) => set({ request: { project } }),
  close: () => set({ request: null }),
}));

/** Asks for the export dialog, on this project when it is given. */
export const askToExport = (project?: string | null): void => useExportRequest.getState().ask(project);

/** The palette's "Export a project…": the project of where the person is, else the dialog asks which. */
export function exportCurrentProject(): void {
  const { place, notes } = useWorkspace.getState();
  askToExport(currentProject(place, notes)?.project ?? null);
}
