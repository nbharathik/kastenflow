// The two bar actions a batch cannot carry: Duplicate and Trash. They go row by
// row through the vault client or the store (every change is still an
// ordinary core op, one commit each), give one notice for all, and one Undo
// that takes every one back. They are not all-or-none: a row that fails is
// skipped and counted.

import type { NoteMeta } from "../../../../lib/vault/types";
import { announce, type BulkDeps, type Done } from "../../../library/bulk";
import { titleOf } from "../../../workspace/names";
import { useWorkspace } from "../../../workspace/store";

export function bulkDeps(progress?: (done: number, total: number) => void): BulkDeps | null {
  const workspace = useWorkspace.getState();
  if (!workspace.client) return null;
  return {
    client: workspace.client,
    notes: () => useWorkspace.getState().notes,
    noteChanged: workspace.noteChanged,
    refresh: workspace.refresh,
    move: (path, project) => workspace.move(path, project, true),
    trash: (path) => workspace.trash(path, true),
    progress,
    noun: "row",
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Makes a copy of each row beside it; Undo moves the copies to the trash. */
export async function duplicateRows(deps: BulkDeps, rows: readonly NoteMeta[]): Promise<Done> {
  const copies: string[] = [];
  const failed: string[] = [];
  for (const [i, row] of rows.entries()) {
    try {
      copies.push((await deps.client.duplicate(row.path)).meta.path);
    } catch (err) {
      failed.push(err instanceof Error ? err.message : String(err));
    }
    deps.progress?.(i + 1, rows.length);
  }
  await deps.refresh();
  const first = rows.length === 1 && copies.length === 1 ? titleOf(rows[0]!) : null;
  const tail = failed.length > 0 ? ` (${failed.length} failed: ${failed[0]})` : "";
  return {
    text: `${first ? `Made a copy of “${first}”` : `Made ${plural(copies.length, "copy", "copies")} of ${plural(rows.length - failed.length, "row")}`}${tail}`,
    undo:
      copies.length > 0
        ? async () => {
            for (const path of copies) await deps.trash(path);
            await deps.refresh();
          }
        : undefined,
  };
}

export { announce };
