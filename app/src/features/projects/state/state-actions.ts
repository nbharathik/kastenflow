// Changing a project's status or health from wherever the app offers it: the
// hub's cards, the project's own page and its overview. The core makes the
// change in one commit; this takes the new page into the note list and says
// what happened, with an Undo that puts the old values back.

import type { ProjectHealth, ProjectStateChange, ProjectStatus } from "../../../lib/vault/project-types";
import type { NoteMeta } from "../../../lib/vault/types";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { healthOfProps, statusOfProps } from "./status";

/** What a change here may touch: the status and the health. */
export type StateChange = Pick<ProjectStateChange, "status" | "health">;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const named = (value: unknown) => typeof value === "string" && value.trim() !== "";

/** The change that puts back what `change` replaces, from the page's properties
 * as they are now; null when the page says something the app cannot write
 * back (a status of its own making). */
export function previousState(props: Readonly<Record<string, unknown>>, change: StateChange): StateChange | null {
  const back: { status?: ProjectStatus | null; health?: ProjectHealth | null } = {};
  if ("status" in change) {
    const was = statusOfProps(props);
    if (!named(props.status)) back.status = null;
    else if (was !== "Other") back.status = was;
    else return null;
  }
  if ("health" in change) {
    const was = healthOfProps(props);
    if (was === null) back.health = null;
    else if (was !== "Other") back.health = was;
    else return null;
  }
  return back;
}

/** What a change is called in a notice. */
function said(title: string, change: StateChange): string {
  if (change.status === null) return `“${title}” is Active again`;
  if (change.status) return `“${title}” is now ${change.status}`;
  return change.health ? `“${title}” is ${change.health}` : `Cleared the health of “${title}”`;
}

/**
 * Sets the status and health of the project whose page is `note`. Toasts what
 * it did, with an Undo (none for the Undo itself, or when the old value cannot
 * be written back), or the core's reason for refusing. False when it did not
 * change.
 */
export async function changeProjectState(note: Pick<NoteMeta, "path" | "title" | "props" | "kind">, change: StateChange, offerUndo = true): Promise<boolean> {
  const { client, noteChanged, toast } = useWorkspace.getState();
  if (!client) return false;
  const back = offerUndo ? previousState(note.props, change) : null;
  let saved;
  try {
    saved = await client.setProjectState(note.path, change);
  } catch (err) {
    toast(message(err));
    return false;
  }
  noteChanged(saved.meta);
  const title = titleOf(note);
  toast(said(title, change), back ? { label: "Undo", run: () => void changeProjectState(saved.meta, back, false) } : undefined);
  return true;
}
