// Focus mode: every bar goes, leaving the canvas and a tiny hint in a corner.
// The bars come back while the pointer is at an edge of the board and for a
// moment after a key on the board (hooks/useFocusPeek.ts); the key `\` or the
// hint leaves the mode.

import type { BoardController } from "./controller";

export function setFocus(board: BoardController, on: boolean): void {
  // A menu or a half-made choice does not follow the person into focus.
  board.store.setState(on ? { focus: true, menu: null } : { focus: false });
}

export function toggleFocus(board: BoardController): void {
  setFocus(board, !board.store.getState().focus);
}
