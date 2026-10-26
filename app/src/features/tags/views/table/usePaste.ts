// Pasting a block of cells from a spreadsheet (or CSV text) into the table.
// It lands on the active cell: cells fill by their column's type, rows past
// the last become new pages, and all of it is ONE batch: one commit, one
// Undo. Values that do not fit are left out and named; calculated, linked and
// read-only columns are skipped. A paste too big for one batch, or one that
// would make more than a few new pages, asks first.

import { useCallback, type ClipboardEvent } from "react";

import type { BatchChange } from "../../../../lib/vault/batch-types";
import type { NoteMeta, TagSchema, TagView } from "../../../../lib/vault/types";
import { useWorkspace } from "../../../workspace/store";
import { useNoteHome } from "../../home";
import type { Column } from "./columns";
import { runAndTell } from "./bulk-run";
import { useLatest } from "./context";
import type { CellAt } from "./grid";
import { parsePasted } from "./paste-parse";
import { addQuestion, ASK_ABOVE_NEW, cutQuestion, pasteNotice, planPaste, type PastePlan } from "./paste-plan";
import { prefill } from "./prefill";

interface Args {
  tag: string;
  view: TagView;
  schema: TagSchema | null;
  columns: readonly Column[];
  rows: readonly NoteMeta[];
  /** The active cell, if any. */
  at: CellAt | null;
  /** A cell is being edited: the editor takes the paste. */
  editing: boolean;
  /** Makes rows for a table that is not one tag's; such a table cannot add rows by pasting. */
  add?: unknown;
}

const pathsOf = (changes: readonly BatchChange[]) => changes.flatMap((c) => (typeof c.path === "string" ? [c.path] : []));

async function execute(plan: PastePlan): Promise<void> {
  const rows = plan.touched + plan.added;
  await runAndTell(plan.changes, `Paste ${rows.toLocaleString()} ${rows === 1 ? "row" : "rows"} into a table`, pathsOf(plan.changes), pasteNotice(plan), "Took back the paste");
}

export function usePaste(args: Args): (event: ClipboardEvent<HTMLElement>) => void {
  const home = useNoteHome();
  const latest = useLatest({ ...args, home });
  return useCallback(
    (event) => {
      const { tag, view, schema, columns, rows, at, editing, add, home } = latest.current;
      // An open editor, or anything but the grid itself, takes its own paste.
      if (event.target !== event.currentTarget || editing) return;
      const grid = parsePasted(event.clipboardData.getData("text/plain"));
      if (grid.length === 0) return;
      event.preventDefault();
      const toast = useWorkspace.getState().toast;
      if (!at) return toast("Click the cell where the pasted cells should start, then paste.");
      const fill = view.filter_mode === "any" || add ? {} : prefill(view.filter, schema);
      const plan = planPaste({ grid, at, columns, notes: rows, tag, fill, home, canAdd: !add });
      if (plan.refused) return toast(plan.refused);
      if (plan.changes.length === 0) return toast(pasteNotice(plan));
      if (plan.cutRows > 0) return toast(cutQuestion(plan), { label: `Paste the first ${plan.keptRows.toLocaleString()}`, run: () => void execute(plan) });
      if (plan.added > ASK_ABOVE_NEW) return toast(addQuestion(plan), { label: `Make ${plan.added.toLocaleString()} pages`, run: () => void execute(plan) });
      void execute(plan);
    },
    [latest],
  );
}
