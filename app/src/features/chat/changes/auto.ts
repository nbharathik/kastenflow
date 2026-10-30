// "Auto" for a thread: when its turn ends with changes staged, the small ones
// to the page being worked on are applied (the same call as the Apply button,
// so the same core write, commit and undo); anything larger or riskier stays
// staged as a card for the person to decide. Review everything and a locked
// note win over this, as over every choice.

import { countChanges, diffLines } from "../../review/diff";
import { useChat } from "../store";
import type { Thread } from "../thread";
import type { ChangesView } from "../types";
import { heldByMode, writeChoiceOf } from "../writes";
import { applyChanges, loadChanges } from "./changes";

/** Most lines a change may add and remove together, and remove alone, to count as small. */
export const SMALL_CHANGE = 40;
export const SMALL_REMOVAL = 20;

/** A step that moves, renames or takes something out of the vault is never small. */
const RISKY_STEP = /\b(trash|delete|remove|move|rename|restore)\b/i;

/** The pages the person is working on in this thread: its page chips, and the pages its selections come from. */
export function workingPaths(thread: Pick<Thread, "context">): Set<string> {
  const paths = new Set<string>();
  for (const chip of thread.context) {
    if (chip.kind === "note" && chip.ref[0]) paths.add(chip.ref[0]);
    if (chip.kind === "selection" && chip.selection?.source.kind === "page") paths.add(chip.selection.source.path);
  }
  return paths;
}

/** Whether a staged set is small and safe to apply without asking: edits to notes in `scope` that exist, add
 * nothing else (no new files or pictures), moved nothing, and are short. */
export function isSmallAndSafe(view: ChangesView, scope: ReadonlySet<string>): boolean {
  if (view.files.length === 0 || view.pictures.length > 0) return false;
  if (view.steps.some((step) => RISKY_STEP.test(step.summary) || step.paths.some((p) => !scope.has(p)))) return false;
  return view.files.every((file) => {
    if (file.kind !== "note" || file.new || file.stale || file.before === null || !scope.has(file.path)) return false;
    if (file.after.trim() === "" && file.before.trim() !== "") return false;
    const { added, removed } = countChanges(diffLines(file.before, file.after));
    return added + removed <= SMALL_CHANGE && removed <= SMALL_REMOVAL;
  });
}

/** Applies the thread's staged changes if it is on Auto and they are small and safe; whether it did. */
export async function autoApplyIfSmall(chat: string): Promise<boolean> {
  const thread = useChat.getState().threads[chat];
  if (!thread || thread.streaming || !thread.changes || writeChoiceOf(thread) !== "auto") return false;
  // Review everything holds every change; the choice cannot loosen it.
  if (heldByMode() === "review") return false;
  let view: ChangesView;
  try {
    view = await loadChanges(chat);
  } catch {
    return false;
  }
  if (!isSmallAndSafe(view, workingPaths(thread))) return false;
  const done = await applyChanges(chat);
  return done.ok && done.value.status === "applied";
}
