// The whiteboards that are open, so a palette command can act on the one in
// front. A board inside a page is not one of them: its page's header and the
// board's own bars are how it is worked on.

import { useWorkspace } from "../../workspace/store";
import type { BoardController } from "./state/controller";

const open = new Map<string, BoardController>();

/** Notes that `board` is open; the returned function says it closed. */
export function registerBoard(board: BoardController): () => void {
  open.set(board.path, board);
  return () => {
    if (open.get(board.path) === board) open.delete(board.path);
  };
}

/** The whiteboard shown in the focused pane, if it shows one. */
export function boardInFront(): BoardController | undefined {
  const { place } = useWorkspace.getState();
  return place.view === "boards" && place.path ? open.get(place.path) : undefined;
}
