// The changes each action of the selection bar makes, as batch changes: one
// per picked row (or one for all, for a board). The core checks every one
// again and makes them all or none. Pure, table-tested. Trash and Duplicate
// are not here: a batch cannot carry them.

import { BATCH_LIMITS, type BatchChange } from "../../../../lib/vault/batch-types";
import type { NoteMeta } from "../../../../lib/vault/types";
import { propOf } from "../../../panel/properties/values";
import { ancestors, movable } from "../../../workspace/tree";
import { sameValue } from "./format";

/** The changes, and how many rows needed none. */
export interface Planned {
  changes: BatchChange[];
  skipped: number;
}

const lower = (s: string) => s.toLowerCase();

/** A refusal sentence when too many rows are picked for one batch, else null. */
export function tooMany(changes: number): string | null {
  return changes > BATCH_LIMITS.changes ? `You can change up to ${BATCH_LIMITS.changes} rows at once and this would change ${changes}. Pick fewer and try again.` : null;
}

/** Sets one property on each row that does not hold the value (null clears it). */
export function setPropertyChanges(rows: readonly NoteMeta[], key: string, value: unknown): Planned {
  const changes: BatchChange[] = [];
  for (const row of rows) {
    if (sameValue(propOf(row.props, key) ?? null, value)) continue;
    changes.push({ kind: "update_props", path: row.path, props: { [key]: value } });
  }
  return { changes, skipped: rows.length - changes.length };
}

/** Adds `tag` to each row that lacks it. */
export function tagChanges(rows: readonly NoteMeta[], tag: string): Planned {
  const changes: BatchChange[] = [];
  for (const row of rows) {
    if (row.tags.some((t) => lower(t) === lower(tag))) continue;
    changes.push({ kind: "tags", path: row.path, add: [tag], remove: [] });
  }
  return { changes, skipped: rows.length - changes.length };
}

/** Takes `tag` off each row that has it, in the row's own spelling. */
export function removeTagChanges(rows: readonly NoteMeta[], tag: string): Planned {
  const changes: BatchChange[] = [];
  for (const row of rows) {
    const spelled = row.tags.find((t) => lower(t) === lower(tag));
    if (spelled !== undefined) changes.push({ kind: "tags", path: row.path, add: [], remove: [spelled] });
  }
  return { changes, skipped: rows.length - changes.length };
}

/** Moves each row to a project folder (null: the library). Journal days and
 * projects stay, rows already there stay, and a sub-page goes with its page
 * when that moves too. */
export function moveChanges(rows: readonly NoteMeta[], all: readonly NoteMeta[], project: string | null): Planned {
  const here = (n: NoteMeta) => (project ? n.project === project : !n.project && n.path.startsWith("library/"));
  const moving = rows.filter((n) => movable(n) && !here(n));
  const going = new Set(moving.map((n) => n.path));
  const todo = moving.filter((n) => !ancestors(all, n).some((a) => going.has(a.path)));
  return { changes: todo.map((n) => ({ kind: "move", path: n.path, project })), skipped: rows.length - todo.length };
}

/** Puts the rows on a board, in table order, as one change. */
export function addToBoardChanges(board: string, rows: readonly NoteMeta[]): BatchChange[] {
  return [{ kind: "add_to_board", board, notes: rows.map((n) => n.path), layout: "grid" }];
}
