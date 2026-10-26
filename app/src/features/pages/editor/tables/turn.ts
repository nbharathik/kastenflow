// "Turn into database" in the editor: plan the notes from the table and ask the
// page's host to make everything in one commit: the tag, a note per row, and the
// saved page with the table swapped for the embed. The host writes the page and
// shows the saved page again, so on success the editor changes nothing: the
// page file is written by one path only, and one Undo takes back the lot.

import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

import type { LinkProvider } from "../links";
import { defaultName, planDatabase, type TableSpot } from "./database";
import { gridOf } from "./grid";
import { NamePrompt } from "./name-prompt";

/** Which table of the page `table` (at `pos`) is, and how big. */
export function spotOf(doc: Node, table: Node, pos: number): TableSpot {
  let count = 0;
  let index = -1;
  doc.descendants((node, at) => {
    if (node.type.name !== "table") return node.childCount > 0;
    if (at === pos) index = count;
    count++;
    return false;
  });
  return { index, count, rows: table.childCount, columns: table.firstChild?.childCount ?? 0 };
}

/** Makes the database `name` of the table at `pos`; a sentence saying why not, or null when done. */
export async function turnIntoDatabase(view: EditorView, links: LinkProvider, pos: number, name: string): Promise<string | null> {
  const table = view.state.doc.nodeAt(pos);
  if (!table || table.type.name !== "table") return "That table is not there any more.";
  if (!links.turnTableIntoDatabase) return "Databases can be made from a table once the page is saved in a vault.";
  const plan = planDatabase(gridOf(table), name);
  if ("error" in plan) return plan.error;
  const spot = spotOf(view.state.doc, table, pos);
  const made = await links.turnTableIntoDatabase(plan, spot);
  return "error" in made ? made.error : null;
}

/** Opens the name field under the table at `pos`. */
export function askToTurn(view: EditorView, links: LinkProvider, pos: number): void {
  const table = view.state.doc.nodeAt(pos);
  if (!table) return;
  let anchor: { left: number; top: number; right: number; bottom: number };
  try {
    anchor = (view.nodeDOM(pos) as HTMLElement | null)?.getBoundingClientRect() ?? view.dom.getBoundingClientRect();
  } catch {
    anchor = view.dom.getBoundingClientRect();
  }
  new NamePrompt(view, anchor, defaultName(view.state.doc, pos), (name) => turnIntoDatabase(view, links, pos, name));
}
