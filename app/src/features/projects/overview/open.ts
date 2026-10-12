// Opening a project's overview: the place that stands for it, and the project
// a command or a button means from where the person is.

import type { NoteMeta } from "../../../lib/vault/types";
import type { OpenHow } from "../../workspace/store";
import { useWorkspace } from "../../workspace/store";
import type { Place } from "../../workspace/tabs";
import { noteAt } from "../../workspace/tree";

/** The overview of the project whose page is at `path`. */
export const overviewPlace = (path: string): Place => ({ view: "overview", path });

/** The project page the overview of the project of `note` is for, or undefined when it has no project. */
export function projectPageOf(notes: readonly NoteMeta[], note: Pick<NoteMeta, "project"> | undefined): NoteMeta | undefined {
  const folder = note?.project;
  return folder ? notes.find((n) => n.kind === "project" && n.project === folder) : undefined;
}

/** The project the focused tab is in: a page of it, its project page, or its overview. */
export function currentProject(place: Place, notes: readonly NoteMeta[]): NoteMeta | undefined {
  if (!place.path) return undefined;
  return projectPageOf(notes, noteAt(notes, place.path));
}

/** Opens a project's overview; in the tab asked for, else this one. */
export function openOverview(project: Pick<NoteMeta, "path">, how: OpenHow = "here"): void {
  useWorkspace.getState().go(overviewPlace(project.path), how);
}

/** The palette's "Open project overview": the project of where the person is, or a hint when there is none. */
export function openCurrentOverview(): void {
  const { place, notes, toast } = useWorkspace.getState();
  const project = currentProject(place, notes);
  if (!project) return toast("Open a page of a project first, or use a project's Expand button.");
  openOverview(project);
}
