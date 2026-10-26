// The selection chips of a thread. The automatic one is the latest selection:
// a new one replaces it, and it stays when the selection collapses until it is
// sent or dismissed. "Add to chat" keeps a snippet, up to five, so several can
// be collected for one question.

import { MAX_KEPT } from "./selection/chip";
import type { ChatState } from "./store";
import { chipKey, originOf, type Chip, type Thread } from "./thread";

type Update = (id: string, change: (thread: Thread) => Thread) => void;

/** How many snippets the thread keeps. */
export const keptCount = (thread: Thread): number => thread.context.filter((chip) => chip.kind === "selection" && originOf(chip) !== "auto").length;

/** The selection actions for the store's `get` and `update`. */
export function selectionActions(get: () => ChatState, update: Update): Pick<ChatState, "setSelection" | "keepSelection"> {
  return {
    setSelection(id, chip) {
      const key = chipKey(chip);
      update(id, (t) => {
        // The same words are there already, kept or automatic: nothing changes.
        if (t.context.some((c) => chipKey(c) === key)) return t;
        const rest = t.context.filter((c) => !(c.kind === "selection" && originOf(c) === "auto"));
        return { ...t, context: [...rest, { ...chip, origin: "auto" }] };
      });
    },

    keepSelection(id, chip) {
      const thread = get().threads[id];
      if (!thread) return false;
      const key = chipKey(chip);
      const had = thread.context.find((c) => chipKey(c) === key);
      if (had && originOf(had) !== "auto") return true;
      if (keptCount(thread) >= MAX_KEPT) return false;
      const kept: Chip = { ...chip, origin: "added", ...(chip.selection ? { selection: { ...chip.selection, pinned: true } } : {}) };
      update(id, (t) => ({ ...t, context: [...t.context.filter((c) => chipKey(c) !== key), kept] }));
      return true;
    },
  };
}
