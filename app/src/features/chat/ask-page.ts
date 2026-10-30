// How a page asks about itself: a new chat in the dock with the page attached.
// It lives apart from the chat's other actions so the page menu and the command
// list can name it without loading the chat store; that loads on first use.

import { useShell } from "../../lib/store";
import type { NoteMeta } from "../../lib/vault/types";

/** A new chat in the dock, about `note` alone: it does not follow the page in front. */
export async function askAboutPage(note: NoteMeta): Promise<void> {
  const [{ useChat }, { noteChip }] = await Promise.all([import("./store"), import("./context")]);
  useChat.getState().start({ context: [noteChip(note)], open: true, follow: false });
  useShell.getState().toggleChat(true);
}
