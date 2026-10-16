// What a double click on the slide does, by what is under the pointer.

import { isCompositeType } from "../composite-kinds.ts";
import { requestFieldFocus } from "../field-focus.ts";
import type { EditorSession } from "../session/session.ts";
import { editCellAt } from "../table/pointer.ts";
import type { EditorUi } from "../ui-state.ts";
import { hitAt, itemsOf, itemsOfList } from "./geometry.ts";

/** The place of a double click: in slide units, and in the window when that is known (the caret goes there). */
interface Where {
  x: number;
  y: number;
  client?: { x: number; y: number } | undefined;
}

/**
 * A double click on an element with words in it opens its text for editing; on a table, the cell under the pointer; on a group, the group
 * and what is under the pointer; on a composite, its format options, with the caret in the field for what it is made of (the code, the formula ...).
 */
export function doubleClickAt(session: EditorSession, ui: EditorUi, zoom: number, p: Where): void {
  if (session.state.tool !== "select") return;
  const id = hitAt(itemsOf(session), { x: p.x, y: p.y }, zoom);
  if (id === null) return;
  const element = session.scope.find((e) => e.id === id);
  if (element?.type === "table") {
    editCellAt(session, id, { x: p.x, y: p.y }, p.client);
    return;
  }
  if (element?.type === "group") {
    const child = hitAt(itemsOfList(session, element.children), { x: p.x, y: p.y }, zoom);
    session.enterGroup(id, child ?? undefined);
    return;
  }
  if (element && isCompositeType(element.type)) {
    session.select([id]);
    ui.openPanel("format");
    requestFieldFocus(ui, id);
  } else if (element && (element.type === "text" || element.type === "shape" || element.type === "connector") && !element.locked) {
    // The word where the pointer is comes selected, as in a document.
    session.startEditing(id, p.client ? { at: p.client, select: "word" } : undefined);
  }
}
