// Pages dragged in the sidebar: onto a project they move into it, onto
// Pages out to the library, onto another page inside it, as in Notion. A
// target lights up only for notes that would go there.

import { useState, type DragEvent } from "react";

import type { NoteMeta } from "../lib/vault/types";
import { carriesNotes, draggedNotes, droppedNotes } from "../features/workspace/drag";
import { nestable, nestNote } from "../features/workspace/placing";
import { droppedOn, moveInto } from "../features/workspace/project-actions";
import { moveBeside } from "../features/workspace/reorder";
import { useWorkspace } from "../features/workspace/store";
import { dropPlan, type Edge } from "./drop-plan";

/** How a project, a page or Pages shows that a dragged page would go in. */
export const DROP_INTO = "rounded-md bg-accent/10 ring-1 ring-inset ring-accent/50";

/** The line that shows a dragged page would go before or after a row. */
export const DROP_EDGE: Record<Edge, string> = {
  before: "shadow-[inset_0_2px_0_0_var(--color-accent)]",
  after: "shadow-[inset_0_-2px_0_0_var(--color-accent)]",
};

/** A project row being dragged (to reorder), not a page to place. */
const reordering = (event: DragEvent) => event.dataTransfer.types.includes("application/x-kasten-project");

/** Whether a drag over the target for `project` (null: the library's
 * pages) would place anything there. A drag from another window might.
 * With `unnest` false, a sub-page already there does not count. */
export function wouldMove(event: DragEvent, project: string | null, unnest = true): boolean {
  if (!carriesNotes(event) || reordering(event)) return false;
  const paths = draggedNotes();
  return paths === null || droppedOn(useWorkspace.getState().notes, paths, project).some((d) => unnest || !d.unnest);
}

/** Whether a drag is over a list item's own row, not a row listed under it:
 * a sub-page dropped on a row that refuses it is not taken out of its page. */
export function onOwnRow(event: DragEvent<HTMLElement>): boolean {
  const row = event.currentTarget.firstElementChild;
  return !row || event.target === event.currentTarget || (event.target instanceof Node && row.contains(event.target));
}

/** A page row as a drop target: dragged pages go inside it (the middle of the
 * row) or beside it (its edges, see drop-plan.ts). */
export function useNestDrop(into: NoteMeta) {
  const [over, setOver] = useState(false);
  const [edge, setEdge] = useState<Edge | null>(null);
  const clear = () => {
    setOver(false);
    setEdge(null);
  };
  const planFor = (event: DragEvent<HTMLElement>, paths: readonly string[] | null) => {
    if (!carriesNotes(event) || reordering(event)) return null;
    const box = event.currentTarget.getBoundingClientRect();
    return dropPlan(useWorkspace.getState().notes, paths, into, box.height > 0 ? (event.clientY - box.top) / box.height : 0.5);
  };
  return {
    over,
    edge,
    handlers: {
      onDragOver(event: DragEvent<HTMLElement>) {
        const plan = planFor(event, draggedNotes());
        if (!plan) return clear();
        // The page, not the project around it, takes the drop.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setOver(plan.kind === "into");
        setEdge(plan.edge ?? null);
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        clear();
      },
      onDrop(event: DragEvent<HTMLElement>) {
        clear();
        const paths = droppedNotes(event);
        const plan = planFor(event, paths);
        if (!plan) return;
        event.preventDefault();
        event.stopPropagation();
        const ws = useWorkspace.getState();
        if (plan.kind === "refuse") ws.toast(plan.why);
        else if (plan.kind === "beside") void moveBeside(paths[0]!, into.path, plan.after);
        else if (plan.kind === "out") void nestNote(plan.path, plan.parent);
        else {
          const notes = nestable(ws.notes, paths, into);
          void (async () => {
            for (const note of notes) await nestNote(note.path, into.path);
          })();
        }
      },
    },
  };
}

/** Moves the dropped notes that belong there to `project`. */
export function takeDrop(event: DragEvent, project: string | null, unnest = true): void {
  event.preventDefault();
  void moveInto(droppedNotes(event), project, unnest);
}

/** A drop target for `project`: its handlers, and whether a drag that
 * would move something is over it. */
export function useDropInto(project: string | null) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver(event: DragEvent) {
        if (!wouldMove(event, project)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setOver(false);
      },
      onDrop(event: DragEvent) {
        setOver(false);
        if (wouldMove(event, project)) takeDrop(event, project);
      },
    },
  };
}
