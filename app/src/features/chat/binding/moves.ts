// A page, deck, diagram or document that was renamed or moved: the chats tied
// to it follow it (chat_rebind). Called from the workspace's single hook for
// moved paths, loaded on demand so the chat is not on the start-up path.

import { inTauri } from "../../../lib/api";
import { useChat } from "../store";

/** Tells the backend which paths moved, and reads the ties again so the headers say the new names. */
export async function rebindChats(moves: ReadonlyMap<string, string>): Promise<number> {
  const list = [...moves].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to }));
  if (list.length === 0) return 0;
  const chat = useChat.getState();
  // In the browser preview nothing is tied before the chat has been used; in the app, saved chats are tied already.
  const client = chat.client ?? (inTauri() ? chat.ensure() : null);
  if (!client) return 0;
  try {
    const changed = await client.rebind(list);
    if (changed > 0) await chat.loadSaved();
    return changed;
  } catch {
    // A tie that did not follow is found again by its page's id, or can be tied again.
    return 0;
  }
}
