// The menu a right click on the slide opens: the cells' on the cells of a table, the block's on a block, the slide's on the empty slide.

import type { MouseEvent } from "react";

import type { EditorSession } from "../session/session.ts";
import { openCellsMenu } from "../table/menu.ts";
import type { EditorUi } from "../ui-state.ts";
import { hitAt, itemsOf } from "./geometry.ts";

/** Opens the context menu for a right click at `at` (slide units). `zoom` is the scale the slide is drawn at. */
export function openContextMenuAt(session: EditorSession, ui: EditorUi, zoom: number, event: MouseEvent, at: { x: number; y: number }): void {
  // On a move handle it is the block's (or the selection's) menu.
  const onHandle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-move]") : null;
  const id = onHandle ? onHandle.dataset.move || (session.state.selection[0] ?? null) : hitAt(itemsOf(session), at, zoom);
  // On the cells of a table the menu is the cells': it picks the cell under the pointer unless that is in the block already picked.
  if (id !== null && !onHandle && openCellsMenu(session, ui, id, { slide: at, client: { x: event.clientX, y: event.clientY } })) return;
  // A right click on an element that is not selected selects it first, as in every editor.
  if (id !== null && !session.state.selection.includes(id)) session.select([id]);
  if (id === null) session.select([]);
  ui.openContextMenu({ kind: id === null ? "canvas" : "element", x: event.clientX, y: event.clientY });
}
