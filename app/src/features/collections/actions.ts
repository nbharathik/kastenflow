// What a collection's notes can be sent to: a board, the side peek, the AI
// chat's context. All of them are the actions the Library and the Inbox
// already have; none changes a note, and none is run for the collection as a
// whole unless the person ticked the rows.

import { useShell } from "../../lib/store";
import type { NoteMeta } from "../../lib/vault/types";
import { cardsChip } from "../chat/context";
import { useChat } from "../chat/store";
import { addToBoard, announce, sharedProject, type BulkDeps } from "../library/bulk";
import { usePeek } from "../peek/store";
import { useWorkspace } from "../workspace/store";

/** Shows the note at the side without leaving the collection. */
export function peekNote(path: string): void {
  usePeek.getState().open(path, "side");
}

function depsOf(): BulkDeps | null {
  const workspace = useWorkspace.getState();
  if (!workspace.client) return null;
  return {
    client: workspace.client,
    notes: () => useWorkspace.getState().notes,
    noteChanged: workspace.noteChanged,
    refresh: workspace.refresh,
    move: (path, project) => workspace.move(path, project, true),
    trash: (path) => workspace.trash(path, true),
  };
}

/** Puts the notes on a board (a new one, named `title`, when `board` is a title only). */
export async function addNotesToBoard(paths: string[], board: { path: string; title: string } | { title: string }, notes: readonly NoteMeta[]): Promise<void> {
  const deps = depsOf();
  if (!deps) return;
  try {
    const target = "path" in board ? board : { path: await deps.client.createBoard(board.title, sharedProject([...notes])), title: board.title };
    announce(await addToBoard(deps, paths, target), useWorkspace.getState().toast);
  } catch (err) {
    useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
  }
}

/** Adds the notes to the open AI chat as one context chip, opening the chat. */
export function addToAiContext(notes: readonly NoteMeta[]): void {
  if (notes.length === 0) return;
  const chat = useChat.getState();
  useShell.getState().toggleChat(true);
  const id = chat.active && chat.threads[chat.active] ? chat.active : chat.start({ open: true });
  chat.addChip(id, cardsChip(notes));
  useWorkspace.getState().toast(notes.length === 1 ? "Added the note to the chat's context" : `Added ${notes.length} notes to the chat's context`);
}
