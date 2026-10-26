// What the block menu offers on a table (Ctrl+/ with the caret in it, or the
// block handle): rows and columns, column alignment, Copy as CSV, and Turn
// into database. Each is reachable by keyboard through the menu.

import type { Node } from "@milkdown/kit/prose/model";
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import type { LinkProvider } from "../links";
import type { MenuItem } from "../ui/popover";
import type { Align } from "./cells";
import { toCsv } from "./csv";
import { gridOf } from "./grid";
import { alignColumn, columnAlignment, insertColumn, insertRow, tableAround } from "./ops";
import { askToTurn } from "./turn";

const links = new WeakMap<EditorView, LinkProvider>();

/** Tells the table menu what the page can do (copy, make a database). */
export function setTableLinks(view: EditorView, provider: LinkProvider | undefined): void {
  if (provider) links.set(view, provider);
  else links.delete(view);
}

const ALIGNMENTS: { align: Align; label: string }[] = [
  { align: "left", label: "Left" },
  { align: "center", label: "Centre" },
  { align: "right", label: "Right" },
  { align: null, label: "Default" },
];

/** Puts the caret in the first (or last) cell of the table at `pos` unless it is in that table
 * already: the menu may have been opened from the table's handle, and then a row or a column
 * is added at the end, an alignment is of the first column. */
function enter(view: EditorView, pos: number, cell: "first" | "last"): void {
  if (tableAround(view.state)?.pos === pos) return;
  const table = view.state.doc.nodeAt(pos);
  if (!table) return;
  const sel = cell === "first" ? Selection.findFrom(view.state.doc.resolve(pos + 1), 1, true) : Selection.findFrom(view.state.doc.resolve(pos + table.nodeSize - 1), -1, true);
  if (sel) view.dispatch(view.state.tr.setSelection(sel));
}

export function copyAsCsv(view: EditorView, table: Node): void {
  const provider = links.get(view);
  const csv = toCsv(gridOf(table));
  if (provider?.copyText) provider.copyText(csv, "Copied the table as CSV");
  else void navigator.clipboard?.writeText(csv);
}

export function tableMenuItems(view: EditorView, pos: number, table: Node): MenuItem[] {
  const act = (command: (state: typeof view.state, dispatch: typeof view.dispatch) => boolean, cell: "first" | "last" = "first") => () => {
    enter(view, pos, cell);
    command(view.state, view.dispatch);
  };
  const inside = tableAround(view.state)?.pos === pos;
  const current = inside ? columnAlignment(view.state) : undefined;
  const items: MenuItem[] = [
    { key: "table-row", label: "Add row below", icon: "icon:plus", onPick: act(insertRow("below"), "last") },
    { key: "table-column", label: "Add column to the right", icon: "icon:plus", onPick: act(insertColumn("right"), "last") },
    {
      key: "table-align",
      label: "Align column",
      icon: "icon:table",
      submenu: () => [{ items: ALIGNMENTS.map(({ align, label }) => ({ key: `align-${align ?? "default"}`, label, active: align === current, onPick: act(alignColumn(align)) })) }],
    },
    { key: "table-csv", label: "Copy as CSV", icon: "icon:copy", onPick: () => copyAsCsv(view, table) },
  ];
  const provider = links.get(view);
  if (provider?.turnTableIntoDatabase) items.push({ key: "table-database", label: "Turn into database", icon: "icon:database", onPick: () => askToTurn(view, provider, pos) });
  return items;
}
