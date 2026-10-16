// A letter typed while cells are picked opens the cell and goes into it. The key press ends where the cell's editor is made, which is
// after it, so the letter waits here until the editor asks for it.

import type { EditorSession } from "../session/session.ts";
import type { CellSelection } from "./cells.ts";

/** How long a letter waits for its editor: a cell that does not open must not hand the letter to some other cell later. */
const WAIT_MS = 1000;

let waiting: { table: string; text: string; at: number } | null = null;

/** Opens the cell at the focus of `cells` with `text` to be typed into it. */
export function typeInto(session: EditorSession, cells: CellSelection, text: string): void {
  waiting = { table: cells.table, text, at: Date.now() };
  session.startEditingCell(cells);
}

/** The letter waiting for the editor of a cell of table `table`, once; null when there is none. */
export function takeTyped(table: string): string | null {
  const found = waiting;
  waiting = null;
  return found && found.table === table && Date.now() - found.at < WAIT_MS ? found.text : null;
}
