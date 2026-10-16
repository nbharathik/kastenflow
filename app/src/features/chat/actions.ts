// What a chat does with the vault from the window: save the thread to
// chats/, pin an answer as a card. Both go through the backend and the
// vault client, so kasten-core writes them. And how a page asks about
// itself: a new chat in the dock with the page attached.

import { useShell } from "../../lib/store";
import type { NoteFile, NoteMeta } from "../../lib/vault/types";
import { useBoards } from "../boards/store";
import { useWorkspace, type OpenHow } from "../workspace/store";
import { openSettingsAt } from "../workspace/views/settings/jump";
import { noteChip } from "./context";
import { flushStream, useChat } from "./store";
import { threadTitle, type Answer } from "./thread";
import { cardFrom, transcript } from "./transcript";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Saves the thread as a note in chats/ and opens it in a new tab. */
export async function saveChat(id: string): Promise<NoteFile | null> {
  flushStream();
  const thread = useChat.getState().threads[id];
  if (!thread || thread.messages.length === 0) return null;
  const { notes, noteChanged, openPath, toast } = useWorkspace.getState();
  try {
    const note = await useChat.getState().ensure().save(threadTitle(thread), transcript(thread, { notes, boards: useBoards.getState().list }));
    noteChanged(note.meta);
    openPath(note.meta.path, "tab");
    return note;
  } catch (err) {
    toast(`The chat was not saved: ${message(err)}`);
    return null;
  }
}

/** Makes a card of an answer, in the Inbox, and notes it on the answer. */
export async function pinAnswer(id: string, answer: Answer, how: OpenHow = "here"): Promise<NoteFile | null> {
  const { client, create, noteChanged, toast, openPath } = useWorkspace.getState();
  if (!client) return null;
  const { title, body } = cardFrom(answer);
  const made = await create({ kind: "card", title }, false);
  if (!made) return null;
  try {
    const saved = (await client.saveBody(made.meta.path, body, made.hash)).note;
    noteChanged(saved.meta);
    useChat.getState().pinned(id, answer.id, saved.meta.path);
    toast(`Pinned “${saved.meta.title}” as a card in the Inbox`, { label: "Open", run: () => openPath(saved.meta.path, how) });
    return saved;
  } catch (err) {
    // The card is made; only its text is missing. Say so, and lead to it.
    toast(`The card “${made.meta.title}” is in the Inbox, but its text was not saved: ${message(err)}`, { label: "Open", run: () => openPath(made.meta.path, how) });
    return null;
  }
}

/** Settings shows the AI providers first when it opens next. */
let jump = false;

/** Opens Settings at "AI providers". */
export function openProviders(how: OpenHow = "here"): void {
  jump = true;
  openSettingsAt({ group: "ai", row: "ai.providers" }, how);
}

/** Whether Settings should scroll to the providers now; asks once. */
export function takeProvidersJump(): boolean {
  const wanted = jump;
  jump = false;
  return wanted;
}

/** A new chat in the dock, about `note` alone: it does not follow the page in front. */
export function askAboutPage(note: NoteMeta): void {
  useChat.getState().start({ context: [noteChip(note)], open: true, follow: false });
  useShell.getState().toggleChat(true);
}
