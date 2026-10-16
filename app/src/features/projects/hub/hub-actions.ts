// What the hub's cards and menus do. Each goes through the same store actions
// and core ops the rest of the app uses; the hub writes no file itself.

import type { ProjectSummary } from "../../../lib/vault/project-types";
import type { NoteMeta } from "../../../lib/vault/types";
import { usePrefs } from "../../workspace/prefs";
import { moveProject, setArchived } from "../../workspace/project-actions";
import { groupOf } from "../../workspace/project-order";
import { setsOfProject } from "../../workspace/tab-sets";
import { resumeSet } from "../../workspace/workspaces";
import { useWorkspace, type OpenHow } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { openOverview } from "../overview/open";

/** A project's overview, opened the way asked for. */
export const openOverviewOf = (s: ProjectSummary, how: OpenHow = "here"): void => openOverview(s, how);

/** The project's own page. */
export const openPageOf = (s: ProjectSummary, how: OpenHow = "here"): void => useWorkspace.getState().openPath(s.path, how);

/** The page the core keeps for a project, as the note list holds it; a stand-in with the same path while the list has not caught up. */
export function pageOf(s: ProjectSummary): NoteMeta {
  return (
    noteAt(useWorkspace.getState().notes, s.path) ?? {
      path: s.path,
      id: s.id,
      title: s.title,
      kind: "project",
      icon: s.icon,
      cover: null,
      parent: null,
      project: s.folder,
      tags: [],
      modified: 0,
      created: null,
      updated: null,
      excerpt: "",
      words: 0,
      props: {},
      locked: false,
    }
  );
}

/** Pins a project to the top of the list, or lets it go: the same pin the sidebar has. */
export const togglePin = (folder: string): void => usePrefs.getState().togglePinnedProject(folder);

/** Archives a project or brings it back; the notice offers Undo. */
export const archiveProject = (s: ProjectSummary, archived: boolean): Promise<boolean> => setArchived(pageOf(s), archived);

/** Whether the project at `index` of `shown` may move a place earlier (-1) or later (1): pinned projects move among the pinned, the rest among the rest. */
export function canShift(shown: readonly string[], index: number, step: -1 | 1): boolean {
  if (index < 0) return false;
  const { start, end } = groupOf(shown, usePrefs.getState().pinnedProjects, index);
  const to = index + step;
  return to >= start && to <= end;
}

/** Moves the project at `index` of `shown` a place; false when it cannot. */
export function shiftProject(shown: readonly string[], index: number, step: -1 | 1): boolean {
  return canShift(shown, index, step) && moveProject(shown, index, index + step);
}

/** A saved set of tabs that belongs to a project, to bring back. */
export interface Resume {
  label: string;
  run(): void;
}

/** The tab sets saved for a project, each as something to resume; none when the project has none (the menu then has no entry). */
export function resumeFor(folder: string): Resume[] {
  const sets = setsOfProject(usePrefs.getState().tabSets, folder);
  return sets.map((set) => ({
    label: sets.length === 1 ? "Resume workspace" : `Resume “${set.name}”`,
    // Pages found by their ids, the saved layout put back, nothing open closed (workspaces.ts).
    run: () => void resumeSet(set),
  }));
}
