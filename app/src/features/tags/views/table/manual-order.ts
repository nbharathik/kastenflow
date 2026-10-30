// Putting a table's rows in order by hand: when it is possible, and the list
// of note ids a move produces (kept in the view as `order`, which the table
// reads only while the view has no sort). Pure, table-tested.

import type { NoteMeta, TagView } from "../../../../lib/vault/types";

/** The most ids the core keeps for one view. */
export const MAX_ORDER = 5000;

interface Where {
  /** Rows come group by group. */
  grouped: boolean;
  /** Rows are a tree of sub-items (dragging a row nests it instead). */
  subItems: boolean;
  /** The table is a project's saved table, not one tag's. */
  custom: boolean;
}

/** Whether rows of this table can be dragged or moved with Alt+↑/↓. */
export function canOrder(view: TagView, where: Where): boolean {
  return view.type === "table" && (view.sort?.length ?? 0) === 0 && !where.grouped && !where.subItems && !where.custom;
}

/** The index a row dragged from `from` ends at when dropped before or after the row at `target`. */
export function dropIndex(from: number, target: number, after: boolean): number {
  if (from === target) return from;
  const at = after ? target + 1 : target;
  return from < at ? at - 1 : at;
}

/**
 * The ids of the whole pool after the row at `from` of `scope` (the rows shown)
 * moves to `to`: rows a filter hides keep their places, since the shown rows
 * only trade the places they held. Null when nothing moves, a row has no id to
 * keep, or the list would be longer than the core takes. Rows without an id
 * are left out (they follow the others, by title).
 */
export function reorderIds(pool: readonly NoteMeta[], scope: readonly NoteMeta[], from: number, to: number): string[] | null {
  if (from === to || from < 0 || to < 0 || from >= scope.length || to >= scope.length) return null;
  if (scope.some((n) => !n.id)) return null;
  const next = scope.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  const inScope = new Set(scope.map((n) => n.id!));
  const queue = next.map((n) => n.id!);
  const out: string[] = [];
  let used = 0;
  for (const n of pool) {
    if (!n.id) continue;
    if (inScope.has(n.id)) out.push(queue[used++]!);
    else out.push(n.id);
  }
  // A shown row the pool lacks goes last.
  while (used < queue.length) out.push(queue[used++]!);
  return out.length > MAX_ORDER ? null : out;
}
