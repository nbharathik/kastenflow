// What the code panel was opened for. A dialog is opened by name only, so the command that opens it leaves the
// target here, keyed by the window it opened in, and the panel reads it once when it mounts.

import type { EditorUi } from "../ui-state.ts";

export type Target =
  /** A new picture: the panel starts with the chooser of templates. */
  | { kind: "new" }
  /** The code picture `id` on the slide `slideId`. */
  | { kind: "edit"; slideId: string; id: string };

const targets = new WeakMap<EditorUi, Target>();

/** Says what the panel is for; call before opening it. */
export function setTarget(ui: EditorUi, target: Target): void {
  targets.set(ui, target);
}

/** What the panel is for (a new picture when nothing was said). */
export function targetOf(ui: EditorUi): Target {
  return targets.get(ui) ?? { kind: "new" };
}
