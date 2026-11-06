// What the quiet "Changed N notes" chip under a thread remembers: which
// change the person put away (so it stays away until the chat changes
// something new), and an undo asked for from the thread's "…" menu, which the
// bar below the thread carries out.

import { create } from "zustand";

import type { Thread } from "../thread";

interface SessionUi {
  /** Per thread: the change the chip was dismissed for. */
  dismissed: Record<string, string>;
  /** Per thread: how many times the menu asked to undo. */
  undoAsked: Record<string, number>;
  dismiss(thread: string, key: string): void;
  askUndo(thread: string): void;
}

export const useSessionUi = create<SessionUi>((set) => ({
  dismissed: {},
  undoAsked: {},
  dismiss: (thread, key) => set((s) => ({ dismissed: { ...s.dismissed, [thread]: key } })),
  askUndo: (thread) => set((s) => ({ undoAsked: { ...s.undoAsked, [thread]: (s.undoAsked[thread] ?? 0) + 1 } })),
}));

/** The newest answer that wrote to the vault (`key`), and how many notes the thread's tools changed (0 when it cannot tell). */
export function lastChange(thread: Pick<Thread, "messages">): { key: string; notes: number } {
  let key = "";
  const paths = new Set<string>();
  for (const message of thread.messages) {
    if (message.role !== "assistant") continue;
    let wrote = false;
    for (const part of message.parts) {
      if (part.kind !== "tool" || !part.result?.ok || part.result.staged) continue;
      for (const path of part.result.paths) {
        paths.add(path);
        wrote = true;
      }
    }
    if (wrote) key = message.id;
  }
  return { key: key || "changed", notes: paths.size };
}

/** "Changed 3 notes"; "Changed notes" when the count is not known. */
export function changedLabel(notes: number): string {
  return notes > 0 ? `Changed ${notes} ${notes === 1 ? "note" : "notes"}` : "Changed notes";
}
