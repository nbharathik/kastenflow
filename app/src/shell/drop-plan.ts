// What dropping pages on a page row in the sidebar does, by where on the row
// they land: the middle puts them inside it, the top or bottom edge puts them
// before or after it: reordering among sub-pages of the same page, otherwise
// into the row's own page, or out to a page of their own when it has none.

import type { NoteMeta } from "../lib/vault/types";
import { nestable } from "../features/workspace/placing";
import { siblingsOf } from "../features/workspace/reorder";
import { noteAt, treeOf } from "../features/workspace/tree";
import { movedIds } from "../features/workspace/tree-order";

export type Edge = "before" | "after";

export type DropPlan =
  | { kind: "into"; edge?: undefined }
  | { kind: "beside"; moved: string; target: string; after: boolean; edge: Edge }
  | { kind: "out"; path: string; parent: string | null; edge: Edge }
  | { kind: "refuse"; why: string; edge?: undefined };

/** The share of a row, top and bottom, that counts as its edge. */
const EDGE = 0.25;

const CYCLE = "A page cannot go inside itself or its own sub-page.";

/** What a drop of `paths` (null: from another window, known only on drop) on
 * the row of `into`, `fraction` of the way down it, would do; null for none. */
export function dropPlan(notes: readonly NoteMeta[], paths: readonly string[] | null, into: NoteMeta, fraction: number): DropPlan | null {
  if (into.kind !== "page") return null;
  const dragged = paths?.map((p) => noteAt(notes, p)).filter((n): n is NoteMeta => n !== undefined);
  const edge: Edge | null = fraction < EDGE ? "before" : fraction > 1 - EDGE ? "after" : null;

  if (!dragged) return edge ? null : { kind: "into" };
  // Passing over the row being dragged is not a drop on it.
  if (dragged.some((n) => n.path === into.path)) return null;
  const cyclic = dragged.some((n) => isInside(notes, into, n));
  if (!edge || dragged.length !== 1) {
    if (cyclic && nestable(notes, paths!, into).length === 0) return { kind: "refuse", why: CYCLE };
    return nestable(notes, paths!, into).length > 0 ? { kind: "into" } : null;
  }

  const moved = dragged[0]!;
  const beside = siblingsOf(notes, into);
  if (beside) {
    if (cyclic || isInside(notes, beside.holder, moved)) return { kind: "refuse", why: CYCLE };
    if (moved.parent === beside.holder.id) {
      const ids = moved.id && into.id ? movedIds(beside.list, moved.id, into.id, edge === "after") : null;
      return ids ? { kind: "beside", moved: moved.id!, target: into.id!, after: edge === "after", edge } : null;
    }
    return moved.kind === "page" || moved.kind === "card" ? { kind: "out", path: moved.path, parent: beside.holder.path, edge } : null;
  }
  // A row that is not inside a page: a sub-page dropped on its edge comes out.
  const holder = moved.parent ? treeOf(notes).byId.get(moved.parent) : undefined;
  return holder?.kind === "page" && holder.path !== moved.path ? { kind: "out", path: moved.path, parent: null, edge } : null;
}

/** Whether `inner` is `outer` or sits below it in the sub-page tree. */
function isInside(notes: readonly NoteMeta[], inner: NoteMeta, outer: NoteMeta): boolean {
  const { byId } = treeOf(notes);
  for (let at: NoteMeta | undefined = inner, steps = 0; at && steps < 64; at = at.parent ? byId.get(at.parent) : undefined, steps++) {
    if (at.path === outer.path) return true;
  }
  return false;
}
