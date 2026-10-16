// What a press, a drag and a double click do on the cells of a table. The canvas controller only hands the pointer here; the places are
// found from the table as it is drawn (`layoutTable`, in the table's own units) and the cells picked go through the session.

import type { Element } from "@kasten-slides/wasm";

import { type Place, layoutTable, placeAt } from "../../render/table-layout.ts";
import type { EditorSession } from "../session/session.ts";
import { type CellSelection, selectionAt } from "./cells.ts";

/** A point of the slide, in slide units. */
interface Point {
  x: number;
  y: number;
}

type TableEl = Extract<Element, { type: "table" }>;

/** The table `id` among the elements in view, if it is one. */
function tableOf(session: EditorSession, id: string): TableEl | null {
  const found = session.scope.find((element) => element.id === id);
  return found?.type === "table" ? found : null;
}

/**
 * The first place of the cell of table `id` under a point of the slide. A table is turned about its middle, so the point is turned back
 * first; it is never mirrored (its words and lines stay the right way up), so flips do not matter. With `clamp`, a point off the table
 * gives the nearest place (a drag that has left it); otherwise null.
 */
export function placeUnder(session: EditorSession, id: string, point: Point, clamp = false): Place | null {
  const table = tableOf(session, id);
  const box = table ? session.elements.boxOf(table) : null;
  if (!table || !box) return null;
  const turn = ((table.rotation ?? 0) * Math.PI) / 180;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const x = cx + dx * Math.cos(-turn) - dy * Math.sin(-turn) - box.x;
  const y = cy + dx * Math.sin(-turn) + dy * Math.cos(-turn) - box.y;
  return placeAt(layoutTable(table, box.w, box.h), x, y, clamp);
}

/** Whether the cells of table `id` can be picked and written in: it is a table, and it is not locked. */
const workable = (session: EditorSession, id: string): boolean => {
  const table = tableOf(session, id);
  return table !== null && !table.locked;
};

/**
 * A press on table `id` while its cells are picked and it is the one thing selected: it picks cells (Shift keeps the anchor and extends
 * the pick; a press without it starts a new one). Answers the cells it picked, or null when the press is not for the cells: the table is
 * moved from its move handle or a press while its frame is what is selected.
 */
export function pressCells(session: EditorSession, id: string, point: Point, extend: boolean): CellSelection | null {
  const { cells, selection } = session.state;
  if (!cells || cells.table !== id || selection.length !== 1 || selection[0] !== id || !workable(session, id)) return null;
  const place = placeUnder(session, id, point);
  if (!place) return null;
  const picked: CellSelection = extend ? { table: id, anchor: cells.anchor, focus: place } : selectionAt(id, place);
  session.selectCells(picked);
  return picked;
}

/** The pointer has moved on to `point` with the press that began at `anchor` still down: the cells between are picked. */
export function dragCells(session: EditorSession, id: string, anchor: Place, point: Point): void {
  const focus = placeUnder(session, id, point, true);
  if (focus) session.selectCells({ table: id, anchor, focus });
}

/** A click on table `id` that went nowhere: it picks the cell under the pointer. Answers whether it did. */
export function pickCell(session: EditorSession, id: string, point: Point): boolean {
  if (!workable(session, id)) return false;
  const place = placeUnder(session, id, point);
  if (!place) return false;
  session.selectCells(selectionAt(id, place));
  return true;
}

/** A double click on table `id`: the cell under the pointer is opened for writing, with the word under the pointer taken. */
export function editCellAt(session: EditorSession, id: string, point: Point, client: Point | undefined): boolean {
  if (!workable(session, id)) return false;
  const place = placeUnder(session, id, point);
  if (!place) return false;
  session.startEditingCell(selectionAt(id, place), client ? { at: client, select: "word" } : undefined);
  return true;
}
