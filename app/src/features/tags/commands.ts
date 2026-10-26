// Palette commands for the database in front: the table's grouping,
// calculations and sub-items, its selection and row order, and the timeline's
// scale and Today. They act on whatever part registered itself as shown (see
// in-front.ts), so each is offered only where it means something. The mouse
// route for each is in the view bar, the table and the timeline.

import type { TagView } from "../../lib/vault/types";
import type { Command } from "../workspace/overlays/commands";
import { inFront } from "./in-front";

const bar = () => inFront("bar");
const onTable = () => bar()?.view.type === "table";

/** The view with a flag removed when off, set when on. */
function flag(view: TagView, key: "sub_items", on: boolean): TagView {
  const next = { ...view };
  if (on) next[key] = true;
  else delete next[key];
  return next;
}

export const DATABASE_COMMANDS: Command[] = [
  {
    id: "table-calcs",
    label: "Table: show or hide calculations",
    words: "database footer sum count average totals row",
    when: onTable,
    run: () => {
      const b = bar();
      if (b) void import("./views/table/calc").then((m) => b.onChange(m.withCalcRow(b.view, !m.showsCalcs(b.view))));
    },
  },
  {
    id: "table-sub-items",
    label: "Table: show or hide sub-items",
    words: "database nested children tree parent rows",
    when: onTable,
    run: () => {
      const b = bar();
      if (b) b.onChange(flag(b.view, "sub_items", b.view.sub_items !== true));
    },
  },
  { id: "table-expand-all", label: "Table: expand all sub-items", words: "database open nested children", when: () => Boolean(bar()?.expandAll) && onTable(), run: () => bar()?.expandAll?.() },
  { id: "table-collapse-all", label: "Table: collapse all sub-items", words: "database close shut nested children", when: () => Boolean(bar()?.collapseAll) && onTable(), run: () => bar()?.collapseAll?.() },
  {
    id: "table-group-none",
    label: "Table: remove grouping",
    words: "database ungroup group by none",
    when: () => onTable() && typeof bar()?.view.group_by === "string" && bar()?.view.group_by !== "",
    run: () => {
      const b = bar();
      if (b) void import("./views/table/group").then((m) => b.onChange(m.withGroup(b.view, null)));
    },
  },
  {
    id: "table-select-all",
    label: "Table: select all rows",
    words: "database pick every bulk",
    when: () => inFront("table") !== null,
    run: () => inFront("table")?.selectAll(),
  },
  { id: "table-select-group", label: "Table: select every row of this group", words: "database pick grouped bulk", when: () => Boolean(inFront("table")?.selectGroup), run: () => inFront("table")?.selectGroup?.() },
  { id: "table-row-up", label: "Table: move the row up", words: "database order earlier higher reorder", when: () => Boolean(inFront("table")?.moveRow), run: () => inFront("table")?.moveRow?.(-1) },
  { id: "table-row-down", label: "Table: move the row down", words: "database order later lower reorder", when: () => Boolean(inFront("table")?.moveRow), run: () => inFront("table")?.moveRow?.(1) },
  { id: "timeline-today", label: "Timeline: go to today", words: "database centre scroll now date", when: () => inFront("timeline") !== null, run: () => inFront("timeline")?.today() },
  ...(["week", "month", "quarter"] as const).map(
    (scale): Command => ({
      id: `timeline-scale-${scale}`,
      label: `Timeline: show by ${scale}`,
      words: "database zoom scale span days",
      when: () => inFront("timeline") !== null,
      run: () => inFront("timeline")?.setScale(scale),
    }),
  ),
];

/** "Group by <property>" for the table in front: one command per property it can group by. */
export function groupCommands(): Command[] {
  const b = bar();
  if (!b || !onTable() || !b.groups) return [];
  return b.groups.map((g) => ({
    id: `table-group-by-${g.key}`,
    label: `Table: group by ${g.label}`,
    words: "database grouping sections",
    run: () => {
      const now = bar();
      if (now) void import("./views/table/group").then((m) => now.onChange(m.withGroup(now.view, g.key)));
    },
  }));
}

export const databaseCommands = (): Command[] => [...DATABASE_COMMANDS, ...groupCommands()];
