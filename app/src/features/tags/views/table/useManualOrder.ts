// Putting rows in order by hand: a drag by the grip, or Alt+↑/↓ on the active
// row. The new order of the whole database is kept in the view (`order`, by
// note id) with ONE batch: one commit, one Undo in the notice. It shows at
// once and is read again from the vault; if the core refuses, the old order
// comes back with one plain sentence. Only while the view has no sort.

import { useCallback, useMemo } from "react";

import { viewOrder } from "../../../../lib/vault/batch-changes";
import type { NoteMeta, TagSchema, TagView } from "../../../../lib/vault/types";
import { titleOf } from "../../../workspace/names";
import { useWorkspace } from "../../../workspace/store";
import { applyView, notesWith } from "../../model";
import { useTags } from "../../store";
import { runAndTell } from "./bulk-run";
import { useLatest } from "./context";
import { dropIndex, MAX_ORDER, reorderIds } from "./manual-order";

/** The view's order shown at once, before the core has written it. */
function showOrder(tag: string, viewName: string, order: string[]): void {
  useTags.setState((s) => ({
    schemas: s.schemas?.map((schema) => (schema.name.toLowerCase() === tag.toLowerCase() ? { ...schema, views: schema.views.map((v) => (v.name === viewName ? { ...v, order } : v)) } : schema)) ?? null,
  }));
}

export interface ManualOrder {
  /** Moves the row one place up (-1) or down (1). */
  move(note: NoteMeta, by: -1 | 1): void;
  /** Drops the dragged row before or after another. */
  dropRow(dragged: string, over: NoteMeta, after: boolean): void;
}

export function useManualOrder(tag: string, view: TagView, schema: TagSchema | null, rows: readonly NoteMeta[]): ManualOrder {
  const latest = useLatest({ tag, view, schema, rows });

  const place = useCallback(
    async (from: number, to: number) => {
      const { tag, view, schema, rows } = latest.current;
      const toast = useWorkspace.getState().toast;
      const row = rows[from];
      if (!row || from === to || to < 0 || to >= rows.length) return;
      if (rows.some((n) => !n.id)) return toast("Some of these pages have no id yet, so the rows cannot be put in order by hand here.");
      // Every note of the database in its order now, filters aside, so a hidden row keeps its place.
      const pool = applyView(notesWith(useWorkspace.getState().notes, tag), { ...view, filter: [] }, schema);
      const ids = reorderIds(pool, rows, from, to);
      if (!ids) return toast(`A table can keep up to ${MAX_ORDER.toLocaleString()} rows in order by hand.`);
      showOrder(tag, view.name, ids);
      const ok = await runAndTell([viewOrder(tag, view.name, ids)], `Reorder the rows of ${view.name}`, [], `Moved “${titleOf(row)}”`, "Put the row back");
      if (!ok) await useTags.getState().load();
    },
    [latest],
  );

  return useMemo<ManualOrder>(
    () => ({
      move(note, by) {
        const from = latest.current.rows.findIndex((n) => n.path === note.path);
        void place(from, from + by);
      },
      dropRow(dragged, over, after) {
        const { rows } = latest.current;
        const from = rows.findIndex((n) => n.path === dragged);
        const target = rows.findIndex((n) => n.path === over.path);
        if (from < 0 || target < 0) return;
        void place(from, dropIndex(from, target, after));
      },
    }),
    [latest, place],
  );
}
