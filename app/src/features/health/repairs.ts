// What a repair on the health page does, said before it is done, and doing it.
// Every repair is an operation the app already has, with its own Undo: the
// trash (a conflict copy), making a page (a link that leads nowhere) and
// drawing a diagram's picture again. Planning reads nothing and writes nothing.

import { drawAgainLater, useDiagramHost } from "../diagrams/host-store";
import { useWorkspace } from "../workspace/store";
import type { Repair } from "./health-sections";

export interface RepairContext {
  /** Whether the diagram editor is installed; null while that is not known. */
  editorInstalled: boolean | null;
}

export interface RepairPlan {
  /** What it will do, a sentence each. */
  will: string[];
  /** What stays as it is. */
  leaves: string;
  /** How to take it back. */
  undo: string;
  /** Why it cannot be done now; null when it can. */
  blocked: string | null;
  /** Does it. Resolves to a sentence about what was done; throws the reason when it is blocked or fails. */
  apply(): Promise<string>;
}

function trashCopy(copy: string, original: string | null): RepairPlan {
  return {
    will: [`Move “${copy}” to the trash.`],
    leaves: original ? `“${original}” is not touched.` : "The page it came from is not at its old place, so the copy is the only one left to read: look at it first. Nothing else changes.",
    undo: "Undo in the notice brings the copy back, and so does Restore in the trash.",
    blocked: null,
    async apply() {
      const trashed = await useWorkspace.getState().trash(copy);
      if (!trashed) throw new Error("The copy could not be moved to the trash.");
      return "Moved the copy to the trash.";
    },
  };
}

function createPage(title: string, project: string | null): RepairPlan {
  return {
    will: [`Make an empty page called “${title}” ${project ? `in the project “${project}”` : "in the library"}.`, `Links to “${title}” then lead to it.`],
    leaves: "No other page changes.",
    undo: "Undo in the notice moves the new page to the trash.",
    blocked: null,
    async apply() {
      const made = await useWorkspace.getState().create({ kind: "page", title, project }, false);
      if (!made) throw new Error(`The page “${title}” could not be made.`);
      const { toast, trash } = useWorkspace.getState();
      toast(`Made “${title}”`, { label: "Undo", run: () => void trash(made.meta.path, true) });
      return `Made the page “${title}”.`;
    },
  };
}

function redrawPicture(diagram: string, title: string, { editorInstalled }: RepairContext): RepairPlan {
  const blocked = editorInstalled === false ? "Install the diagram editor first (Settings, Diagrams): it draws the picture." : null;
  return {
    will: [`Draw the picture of “${title}” again from the diagram.`],
    leaves: "The diagram itself is not changed; only its picture file is drawn again.",
    undo: "The picture before it stays in history, and Restore in History brings it back.",
    blocked,
    async apply() {
      if (blocked) throw new Error(blocked);
      // A picture drawn once in this window is drawn again only when asked to forget that.
      drawAgainLater(diagram);
      useDiagramHost.getState().redraw(diagram);
      return `Drawing the picture of “${title}” again. It updates in a moment.`;
    },
  };
}

/** What `repair` would do. */
export function planRepair(repair: Repair, context: RepairContext): RepairPlan {
  switch (repair.kind) {
    case "trash-copy":
      return trashCopy(repair.copy, repair.original);
    case "create-page":
      return createPage(repair.title, repair.project);
    case "redraw-picture":
      return redrawPicture(repair.diagram, repair.title, context);
  }
}
