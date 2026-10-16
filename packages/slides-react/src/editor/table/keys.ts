// The keys of a table whose cells are picked, with no cell open for writing: the arrows move the pick (Shift extends it), Tab goes to the
// next cell (on the last cell it adds a row), Enter and F2 open the cell, a letter opens it with that letter typed, Mod+A picks every cell.
// Delete, Backspace and the clipboard keys are the editor's own (Delete empties the cells; the clipboard acts on them). Escape picks the frame.

import type { CommandContext } from "../commands/types.ts";
import { type CellSelection, moveFocus, originOf, selectionAt, tabTarget, gridOf } from "./cells.ts";
import { typeInto } from "./typing.ts";

const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** The key press as far as this module reads it. */
type Press = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault" | "isComposing">;

/** Answers whether the key was used. */
export function tableKeys(event: Press, { session }: Pick<CommandContext, "session">): boolean {
  const { cells, editing } = session.state;
  if (!cells || editing !== null || event.isComposing || event.altKey) return false;
  const table = session.scope.find((element) => element.id === cells.table);
  if (table?.type !== "table") return false;
  const chord = event.ctrlKey || event.metaKey;
  const use = (): true => {
    event.preventDefault();
    return true;
  };
  const here = (): CellSelection => selectionAt(cells.table, originOf(gridOf(table), cells.focus));

  const arrow = ARROWS[event.key];
  if (arrow && !chord) {
    session.selectCells(moveFocus(table, cells, arrow[0], arrow[1], event.shiftKey));
    return use();
  }
  if (event.key === "Tab" && !chord) {
    const target = tabTarget(table, cells.focus, event.shiftKey);
    const next = target === "append" ? session.tables.appendRow(cells.table) : target;
    if (next) session.selectCells(selectionAt(cells.table, next));
    return use();
  }
  if ((event.key === "Enter" || event.key === "F2") && !chord) {
    session.startEditingCell(here());
    return use();
  }
  if (chord && event.key.toLowerCase() === "a" && !event.shiftKey) {
    session.tables.selectAll();
    return use();
  }
  // A letter, a digit or a sign opens the cell with it typed, as it does in a spreadsheet.
  if (event.key.length === 1 && event.key !== " " && !chord) {
    typeInto(session, here(), event.key);
    return use();
  }
  return false;
}
