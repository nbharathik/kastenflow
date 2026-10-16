// The menu a right click on the cells of a table opens: it picks the cells under the pointer first (unless they are inside the block that is
// already picked, which is then the block the menu is about), so the menu is always about what looks selected.

import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { gridOf, rangeOfSelection, selectionAt } from "./cells.ts";
import { placeUnder } from "./pointer.ts";

/** A point of the slide, in slide units, and the same place in the window. */
interface Where {
  slide: { x: number; y: number };
  client: { x: number; y: number };
}

/** Opens the cells menu for a right click on table `id` at `where`. Answers whether it did: false for anything but the cells of a table that can be worked on. */
export function openCellsMenu(session: EditorSession, ui: EditorUi, id: string, where: Where): boolean {
  const table = session.scope.find((element) => element.id === id);
  if (table?.type !== "table" || table.locked) return false;
  const place = placeUnder(session, id, where.slide);
  if (!place) return false;
  const { cells } = session.state;
  const inside = cells?.table === id && (() => {
    const range = rangeOfSelection(table, cells);
    const owner = gridOf(table).at(place.row, place.col);
    return owner !== null && owner.row >= range.top && owner.row + owner.rowSpan - 1 <= range.bottom && owner.col >= range.left && owner.col + owner.colSpan - 1 <= range.right;
  })();
  if (!inside) session.selectCells(selectionAt(id, place));
  ui.openContextMenu({ kind: "cells", x: where.client.x, y: where.client.y });
  return true;
}
