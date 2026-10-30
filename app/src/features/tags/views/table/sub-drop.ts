// What dropping a table row on another row does when the table shows
// sub-items: the middle of the row puts it inside, the top or bottom edge (the
// gap between rows) puts it at that row's own level. Pure, unit tested.

import type { NoteMeta } from "../../../../lib/vault/types";
import { carries } from "../../model";
import { isWithin, noteAt, treeOf } from "../../../workspace/tree";

export type SubDrop =
  | { kind: "into" }
  | { kind: "out"; parent: string | null; edge: "before" | "after" }
  | { kind: "refuse"; why: string };

/** The share of a row, top and bottom, that is its edge. */
const EDGE = 0.25;

const CYCLE = "A page cannot go inside itself or its own sub-page.";

/** What dropping `dragged` on the row `over`, `fraction` of the way down it,
 * does; null for nothing. `tag` is the table's: only its rows can be moved. */
export function subDrop(notes: readonly NoteMeta[], dragged: readonly string[] | null, over: NoteMeta, fraction: number, tag: string): SubDrop | null {
  if (!dragged || dragged.length !== 1) return null;
  const moved = noteAt(notes, dragged[0]!);
  if (!moved || moved.path === over.path || !carries(moved, tag)) return null;
  if (moved.kind !== "page" && moved.kind !== "card") return null;
  const edge = fraction < EDGE ? "before" : fraction > 1 - EDGE ? "after" : null;

  if (!edge) {
    if (over.kind !== "page") return null;
    if (moved.id && over.id && moved.parent === over.id) return null;
    return isWithin(notes, over.path, moved) ? { kind: "refuse", why: CYCLE } : { kind: "into" };
  }
  const holder = over.parent ? treeOf(notes).byId.get(over.parent) : undefined;
  const parent = holder && holder.path !== over.path ? holder : undefined;
  if ((moved.parent ?? null) === (parent?.id ?? over.parent ?? null)) return null;
  if (parent && isWithin(notes, parent.path, moved)) return { kind: "refuse", why: CYCLE };
  return { kind: "out", parent: parent?.path ?? null, edge };
}
