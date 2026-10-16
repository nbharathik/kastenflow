// What can be done to a project from a card, the overview, the project page and
// the review screens: pin the task it does next, mark it reviewed (and say when
// to review it again), and write a dated update. Each goes through the core's
// project op (`setProjectState`, one commit) or the page gallery's own create,
// and says what it did in a notice whose Undo puts back exactly what it
// replaced.

import { dayFrom, shortDay } from "../../../lib/dates";
import type { ProjectStateChange } from "../../../lib/vault/project-types";
import type { NoteMeta } from "../../../lib/vault/types";
import { laterDay, type Later } from "../../inbox/queue";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import type { ProjectRef } from "./refs";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The project's open task notes, the soonest due first: what it could do next. */
export function openTasksOf(notes: readonly NoteMeta[], folder: string): NoteMeta[] {
  const due = (n: NoteMeta) => (typeof n.props.due === "string" ? n.props.due : "9999-12-31");
  return notes
    .filter((n) => n.kind !== "template" && n.project === folder && n.tags.some((t) => t.toLowerCase() === "task") && String(n.props.status ?? "").trim().toLowerCase() !== "done")
    .sort((a, b) => due(a).localeCompare(due(b)) || titleOf(a).localeCompare(titleOf(b)));
}

/** Changes the project's state and takes the page into the list; false when the core refused, which the window has said. */
async function change(project: ProjectRef, state: ProjectStateChange): Promise<boolean> {
  const { client, noteChanged, toast } = useWorkspace.getState();
  if (!client) return false;
  try {
    noteChanged((await client.setProjectState(project.path, state)).meta);
    return true;
  } catch (err) {
    toast(message(err));
    return false;
  }
}

/** The notice for something done, with an Undo that runs `run`. */
function offerUndo(text: string, run: () => Promise<unknown>): void {
  useWorkspace.getState().toast(text, { label: "Undo", run: () => void run().catch((err: unknown) => useWorkspace.getState().toast(message(err))) });
}

/** Pins `task` as the note the project does next (null: no next action). */
export async function setNextAction(project: ProjectRef, task: Pick<NoteMeta, "path" | "title"> | null): Promise<boolean> {
  const before = project.nextActionId;
  if (!(await change(project, { nextAction: task ? task.path : null }))) return false;
  const text = task ? `“${task.title}” is the next action of “${project.title}”` : `Cleared the next action of “${project.title}”`;
  offerUndo(text, () => change(project, { nextAction: before }));
  return true;
}

/** Marks the project reviewed today and clears the day its review was due, or sets the next one. */
export async function markReviewed(project: ProjectRef, next: Later | null = null): Promise<boolean> {
  const day = dayFrom(0);
  const again = next ? laterDay(next, day) : null;
  if (!(await change(project, { reviewed: day, reviewAfter: again }))) return false;
  const text = again ? `Reviewed “${project.title}”; its next review is ${shortDay(again)}` : `Marked “${project.title}” as reviewed`;
  offerUndo(text, () => change(project, { reviewed: project.lastReview, reviewAfter: project.reviewAfter }));
  return true;
}

/** Takes the day the project's review is due away, leaving the last review as it was. */
export async function clearReviewDay(project: ProjectRef): Promise<boolean> {
  if (!(await change(project, { reviewAfter: null }))) return false;
  offerUndo(`“${project.title}” has no review day now`, () => change(project, { reviewAfter: project.reviewAfter }));
  return true;
}

/** Writes today's update page in the project, from the update template, opens it and marks the project reviewed today. */
export async function newProjectUpdate(project: ProjectRef): Promise<boolean> {
  const workspace = useWorkspace.getState();
  const day = dayFrom(0);
  const page = await workspace.create({ kind: "page", title: `Update ${day}`, project: project.folder, template: "project-update", date: day }, true);
  if (!page) return false;
  // A page made and a state that would not change leave the page: the notice says so.
  const reviewed = await change(project, { reviewed: day });
  const text = reviewed ? `Made the update for “${project.title}” and marked it reviewed` : `Made the update for “${project.title}”`;
  offerUndo(text, async () => {
    await useWorkspace.getState().trash(page.meta.path, true);
    if (reviewed) await change(project, { reviewed: project.lastReview });
  });
  return true;
}
