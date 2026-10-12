// What an Open menu is for: a vault path or a place, and opening it.

import { useWorkspace, type OpenHow } from "../../features/workspace/store";
import type { OpenTarget } from "./store";

/** The vault path a target names, if it has one. */
export const pathOf = (target: OpenTarget): string | undefined => (typeof target === "string" ? target : target.path);

/** A deck or a diagram opens as a page of its own: it has no peek. */
export const isDeckTarget = (target: OpenTarget): boolean => Boolean(pathOf(target)?.endsWith(".deck") || pathOf(target)?.endsWith(".drawio"));

/** Opens `target` the way asked: a path as `openPath` does (its view found
 * from the file), a place as `go` does. */
export function openAs(target: OpenTarget, how: OpenHow): void {
  const { openPath, go } = useWorkspace.getState();
  if (typeof target === "string") openPath(target, how);
  else go(target, how);
}
