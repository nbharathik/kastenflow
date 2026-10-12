// What a person does on a page map besides syncing it: take off a branch
// whose line has left the page.

import type { BoardController } from "./canvas/state/controller";

/** Takes a branch off the board and out of what the map remembers, as one
 * step to undo. Only the branch goes: whatever hangs from it stays. */
export async function removeBranch(board: BoardController, id: string): Promise<void> {
  const source = board.doc.source;
  const branches = source?.branches;
  if (!source || !branches?.[id]) return;
  const rest = { ...branches };
  delete rest[id];
  await board.commit([
    { kind: "remove", ids: [id] },
    { kind: "source", source: { ...source, branches: rest } },
  ]);
}
