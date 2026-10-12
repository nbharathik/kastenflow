// Taking a board's words out of it: its outline, copied to the clipboard as
// Markdown. Nothing is written to the vault.

import { linkFor } from "../../../workspace/links";
import { noteAt } from "../../../workspace/tree";
import { boardOutline } from "../model/outline-export";
import type { BoardController } from "./controller";

/** Copies the board as an outline and says so (or says it could not). */
export function copyOutline(board: BoardController): Promise<void> | undefined {
  const notes = board.deps.notes();
  const text = boardOutline(board.doc.title, board.doc.nodes, (file, title) => {
    const meta = noteAt(notes, file);
    return meta ? linkFor(meta, notes) : `[[${file.replace(/\.(md|canvas)$/, "")}${title ? `|${title}` : ""}]]`;
  });
  return navigator.clipboard?.writeText(text).then(
    () => board.deps.toast("Copied the board as an outline"),
    () => board.deps.toast("The outline could not be copied"),
  );
}
