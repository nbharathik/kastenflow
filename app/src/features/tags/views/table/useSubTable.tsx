// A table that shows sub-items: the rows laid out as a tree and flattened to
// those visible, what opens and shuts them (remembered per view), and what the
// title cells, the row menu and a drop on a row do with them. A view without
// `sub_items` gets its rows as they are and none of this.

import { useMemo, useState, type ReactNode } from "react";

import type { NoteMeta, TagView } from "../../../../lib/vault/types";
import { PointMenu } from "../../../../shell/PointMenu";
import { titleOf } from "../../../workspace/names";
import { nestNote } from "../../../workspace/placing";
import { useWorkspace } from "../../../workspace/store";
import { useLatest, type SubApi } from "./context";
import { openKey, useOpenRows } from "./open-rows";
import { subDrop } from "./sub-drop";
import { indentRow, indentUnder, outdentRow } from "./sub-moves";
import { flatten, foldKey, type FlatRow } from "./subitems";

export interface SubTable {
  /** The notes in the order the rows are drawn. */
  rows: readonly NoteMeta[];
  /** Each row's depth, fold and greying; null when sub-items are off. */
  meta: readonly FlatRow[] | null;
  /** The rows that match, for the count (all rows when sub-items are off). */
  count: number;
  /** The row a new sub-item is being made under, if any. */
  under: NoteMeta | null;
  clearUnder(): void;
  /** The row menu, to be drawn once. */
  menu: ReactNode;
  /** What the title cells call; the table hands it to the grid's context. */
  api: SubApi;
}

export function useSubTable(tag: string, view: TagView, notes: readonly NoteMeta[], pool: readonly NoteMeta[] | undefined): SubTable {
  const on = view.sub_items === true;
  const opened = useOpenRows(openKey(tag, view.name));
  const flat = useMemo(() => (on ? flatten(notes, pool ?? notes, opened.open) : null), [on, notes, pool, opened.open]);
  const rows = useMemo(() => (flat ? flat.rows.map((r) => r.note) : notes), [flat, notes]);
  const [under, setUnder] = useState<NoteMeta | null>(null);
  const [at, setAt] = useState<{ x: number; y: number; note: NoteMeta } | null>(null);
  const latest = useLatest({ on, flat, set: opened.set, tag });

  const api = useMemo<SubApi>(() => {
    const indexOf = (note: NoteMeta) => latest.current.flat?.rows.findIndex((r) => r.note.path === note.path) ?? -1;
    const open = (note: NoteMeta | null) => note && latest.current.set(foldKey(note), true);
    return {
      get enabled() {
        return latest.current.on;
      },
      toggle: (note, want) => latest.current.set(foldKey(note), want),
      addUnder(note) {
        if (note.kind !== "page") return;
        open(note);
        setUnder(note);
      },
      indent(note) {
        const rows = latest.current.flat?.rows;
        const index = indexOf(note);
        if (rows && index >= 0) void indentRow(rows, index).then(open);
      },
      outdent(note) {
        const rows = latest.current.flat?.rows;
        const index = indexOf(note);
        if (rows && index >= 0) void outdentRow(rows, index);
      },
      menu: (note, x, y) => setAt({ x, y, note }),
      plan: (dragged, over, fraction) => subDrop(useWorkspace.getState().notes, dragged, over, fraction, latest.current.tag),
      drop(plan, dragged, over) {
        if (plan.kind === "refuse") useWorkspace.getState().toast(plan.why);
        else if (plan.kind === "into") void nestNote(dragged[0]!, over.path).then(() => open(over));
        else void nestNote(dragged[0]!, plan.parent);
      },
    };
  }, [latest]);

  let menu: ReactNode = null;
  if (at && flat) {
    const index = flat.rows.findIndex((r) => r.note.path === at.note.path);
    const row = flat.rows[index];
    menu = row ? (
      <PointMenu
        x={at.x}
        y={at.y}
        label={`Options for ${titleOf(at.note)}`}
        onClose={() => setAt(null)}
        items={[
          ...(at.note.kind === "page" ? [{ label: "Add sub-item", hint: "Ctrl+Shift+↵", onSelect: () => api.addUnder(at.note) }] : []),
          ...(indentUnder(flat.rows, index) ? [{ label: "Indent", hint: "Tab", onSelect: () => api.indent(at.note) }] : []),
          ...(row.depth > 0 ? [{ label: "Outdent", hint: "Shift+Tab", onSelect: () => api.outdent(at.note) }] : []),
          ...(row.fold === "closed" ? [{ label: "Expand sub-items", hint: "→", onSelect: () => api.toggle(at.note, true) }] : []),
          ...(row.fold === "open" && !row.dim ? [{ label: "Collapse sub-items", hint: "←", onSelect: () => api.toggle(at.note, false) }] : []),
        ]}
      />
    ) : null;
  }
  return { rows, meta: flat ? flat.rows : null, count: flat ? flat.matching : notes.length, under, clearUnder: () => setUnder(null), menu, api };
}
