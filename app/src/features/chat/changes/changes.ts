// The changes a chat has staged: a chat that previews its changes writes
// nothing to the vault. What it does waits, file by file, until the person
// looks at it and applies it together (one commit, undone with the chat's
// session), recalculates it after the vault moved on, or throws it away.
// Pure helpers, and the actions the bar and the view call.

import { boardFilesChanged } from "../../boards/events";
import { diagramFilesChanged } from "../../diagrams/store";
import { deckFilesChanged } from "../../slides/events";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import type { ApplyResult, ChangesView, FileChange, Recalculated } from "../types";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** "1 change", "3 changes". */
export const changesWords = (count: number) => `${count} ${count === 1 ? "change" : "changes"}`;

/** What kind of thing a staged file is, for its heading. */
export const KIND_WORDS = { note: "Note", deck: "Deck", diagram: "Diagram", board: "Board" } as const;

/** The files that cannot be put together with the vault as it is now. */
export const staleOf = (view: ChangesView): FileChange[] => view.files.filter((file) => file.stale);

/** Files first by what they are, then by title: decks and boards after the notes. */
export function ordered(files: readonly FileChange[]): FileChange[] {
  const rank = { note: 0, deck: 1, board: 2, diagram: 3 } as const;
  return [...files].sort((a, b) => rank[a.kind] - rank[b.kind] || Number(b.new) - Number(a.new) || a.title.localeCompare(b.title));
}

/** What the thread has staged; the thread's bar is kept in step with it. */
export async function loadChanges(chat: string): Promise<ChangesView> {
  const view = await useChat.getState().ensure().changes(chat);
  const count = view.files.length + view.pictures.length;
  useChat.getState().setChanges(chat, count > 0 ? { id: view.id, count, paths: [...view.files.map((f) => f.path), ...view.pictures.map((p) => p.path)] } : undefined);
  return view;
}

/** Lists, open boards, open decks and open diagrams (an editor open on one loads what was written) take in what was written. */
function wrote(paths: string[]): void {
  const notes = paths.filter((p) => p.endsWith(".md"));
  if (notes.length > 0) void useWorkspace.getState().filesChanged(notes);
  boardFilesChanged(paths);
  deckFilesChanged(paths);
  diagramFilesChanged(paths);
  void useWorkspace.getState().refresh();
}

/** The outcome of an action the person asked for. */
export type Done<T> = { ok: true; value: T } | { ok: false; error: string };

/** Writes what the thread staged, as one commit approved by the person. A
 * stale answer keeps everything staged, for the person to recalculate. */
export async function applyChanges(chat: string): Promise<Done<ApplyResult>> {
  const store = useChat.getState();
  const thread = store.threads[chat];
  if (!thread || thread.streaming) return { ok: false, error: "Wait for the answer to finish" };
  try {
    const result = await store.ensure().applyChanges(chat);
    if (result.status === "applied") {
      useChat.getState().applied(chat);
      wrote(result.paths);
      useWorkspace.getState().toast(`Applied ${changesWords(result.paths.length)}`);
    }
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Throws away what the thread staged; the vault is not touched. */
export async function discardChanges(chat: string): Promise<Done<null>> {
  try {
    await useChat.getState().ensure().discardChanges(chat);
    useChat.getState().setChanges(chat, undefined);
    return { ok: true, value: null };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Plans the staged steps again on the vault as it is now. */
export async function recalcChanges(chat: string): Promise<Done<Recalculated>> {
  try {
    const value = await useChat.getState().ensure().recalcChanges(chat);
    await loadChanges(chat);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
