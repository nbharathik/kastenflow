// Asking a question again, or asking it another way: the thread is taken back
// on the backend to before that question (its answer, and everything after,
// goes with it), the window keeps what was there as an earlier version
// (thread-versions.ts), and the question is sent as a new one. What the chat
// changed in the vault stays, in the thread's session. Any question can be
// asked again, not only the newest; the old way stays reachable.

import { useWorkspace } from "../workspace/store";
import { modelFor } from "./prefs";
import type { ChatState } from "./store";
import { isEmptyAnswer, rememberedQuestions, type Thread } from "./thread";
import { forkAt, latestFirst, showVersion } from "./thread-versions";

type Get = () => ChatState;
type Update = (id: string, change: (thread: Thread) => Thread) => void;

/** `retry`, `regenerate`, `resend`, `resendAt` and `showVersion` for the store's `get` and `update`. */
export function redoActions(get: Get, update: Update): Pick<ChatState, "retry" | "regenerate" | "resend" | "resendAt" | "showVersion"> {
  async function ask(id: string, at: number | null, words: (asked: string) => string): Promise<boolean> {
    // Only the version the assistant remembers can be asked from.
    update(id, latestFirst);
    const thread = get().threads[id];
    const count = thread?.messages.length ?? 0;
    const place = at ?? count - 2;
    const asked = thread?.messages[place];
    const answer = thread?.messages[place + 1];
    if (!thread || thread.streaming || thread.stopping || asked?.role !== "user" || (answer && (answer.role !== "assistant" || answer.status === "streaming"))) return false;
    // Regenerate asks the newest question, which must have its answer.
    if (at === null && !answer) return false;
    const text = words(asked.text).trim();
    // Nothing is taken back that could not then be sent.
    if (!text || !modelFor(thread, get().providers)) return false;
    try {
      await get().ensure().rewind(id, rememberedQuestions(thread.messages, place));
    } catch {
      useWorkspace.getState().toast("Could not take the answer back, so nothing was changed");
      return false;
    }
    const before = get().threads[id]!;
    update(id, (t) => forkAt(t, place));
    // What went with the question goes with it again.
    const went = await get().send(id, text, asked.attachments);
    // Not sent after all: the conversation is as it was.
    if (!went) update(id, (t) => (t.messages.length === place ? before : t));
    return went;
  }

  return {
    async retry(id) {
      update(id, latestFirst);
      const thread = get().threads[id];
      const count = thread?.messages.length ?? 0;
      const failed = thread?.messages[count - 1];
      const asked = thread?.messages[count - 2];
      // An answer that failed, or one that came back with nothing in it.
      const empty = failed?.role === "assistant" && isEmptyAnswer(failed);
      if (!thread || thread.streaming || failed?.role !== "assistant" || (failed.status !== "error" && !empty) || asked?.role !== "user") return false;
      if (empty) {
        // The backend counted this empty answer as given: it is taken back first.
        try {
          await get().ensure().rewind(id, rememberedQuestions(thread.messages, count - 2));
        } catch {
          useWorkspace.getState().toast("Could not take the answer back, so nothing was changed");
          return false;
        }
      }
      // An answer that said nothing left no trace in the backend's thread, so
      // the question takes its place instead of standing twice.
      if (failed.parts.length === 0 || empty) update(id, (t) => ({ ...t, messages: t.messages.slice(0, -2) }));
      return get().send(id, asked.text, asked.attachments);
    },
    regenerate: (id) => ask(id, null, (asked) => asked),
    resend: (id, text) => ask(id, null, () => text),
    resendAt: (id, message, text) => {
      const at = get().threads[id]?.messages.findIndex((m) => m.id === message) ?? -1;
      return at < 0 ? Promise.resolve(false) : ask(id, at, () => text);
    },
    showVersion(id, at, k) {
      const thread = get().threads[id];
      if (!thread || thread.streaming) return;
      update(id, (t) => showVersion(t, at, k));
    },
  };
}
