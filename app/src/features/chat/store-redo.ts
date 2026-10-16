// Asking the last question again, or asking it another way: the thread is
// taken back on the backend to before that question (its answer goes with
// it), the window drops the pair, and the question is sent as a new one. What
// the chat changed in the vault stays, in the thread's session.

import { modelFor } from "./prefs";
import type { ChatState } from "./store";
import { rememberedQuestions, type Thread } from "./thread";

type Get = () => ChatState;
type Update = (id: string, change: (thread: Thread) => Thread) => void;

/** `regenerate` and `resend` for the store's `get` and `update`. */
export function redoActions(get: Get, update: Update): Pick<ChatState, "regenerate" | "resend"> {
  async function ask(id: string, words: (asked: string) => string): Promise<boolean> {
    const thread = get().threads[id];
    const count = thread?.messages.length ?? 0;
    const answer = thread?.messages[count - 1];
    const asked = thread?.messages[count - 2];
    if (!thread || thread.streaming || answer?.role !== "assistant" || answer.status === "streaming" || asked?.role !== "user") return false;
    const text = words(asked.text).trim();
    // Nothing is taken back that could not then be sent.
    if (!text || !modelFor(thread, get().providers)) return false;
    try {
      await get().ensure().rewind(id, rememberedQuestions(thread.messages, count - 2));
    } catch {
      return false;
    }
    update(id, (t) => ({ ...t, messages: t.messages.slice(0, -2) }));
    // What went with the question goes with it again.
    return get().send(id, text, asked.attachments);
  }

  return {
    regenerate: (id) => ask(id, (asked) => asked),
    resend: (id, text) => ask(id, () => text),
  };
}
