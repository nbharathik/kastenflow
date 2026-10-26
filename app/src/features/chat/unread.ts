// Which threads finished, paused or failed while you were looking elsewhere,
// and how many work now: the dot on the Chat button, the count on it, on the
// Slides assistant tab and in the Chat view's list. A thread is "in view" while
// something shows it (the dock, the Chat view, a deck's assistant tab); it is
// cleared the moment it is opened.

import { useEffect } from "react";
import { create } from "zustand";

import type { Thread } from "./thread";

/** What happened to a thread out of sight, the most pressing last. */
export type Outcome = "done" | "needs" | "failed";

const RANK: Record<Outcome, number> = { done: 0, needs: 1, failed: 2 };

interface UnreadState {
  /** Threads with something you have not seen. */
  unseen: Record<string, Outcome>;
  /** How many places show each thread now. */
  viewing: Record<string, number>;
  /** How many threads work now (the chat store keeps this; the window's button reads it without loading the chat). */
  working: number;
  setWorking(count: number): void;
  /** A thread finished (`done`), stopped for you (`needs`) or failed. Nothing to see when it is in view. */
  note(id: string, outcome: Outcome): void;
  /** A place shows the thread: it is seen. Returns the way to say it no longer does. */
  view(id: string): () => void;
  /** A thread was removed. */
  forget(id: string): void;
}

const without = (unseen: Record<string, Outcome>, id: string) => {
  if (!(id in unseen)) return unseen;
  const next = { ...unseen };
  delete next[id];
  return next;
};

export const useUnread = create<UnreadState>()((set, get) => ({
  unseen: {},
  viewing: {},
  working: 0,

  setWorking(count) {
    if (get().working !== count) set({ working: count });
  },

  note(id, outcome) {
    if ((get().viewing[id] ?? 0) > 0) return;
    set((s) => {
      const had = s.unseen[id];
      return had && RANK[had] >= RANK[outcome] ? s : { unseen: { ...s.unseen, [id]: outcome } };
    });
  },

  view(id) {
    set((s) => ({ viewing: { ...s.viewing, [id]: (s.viewing[id] ?? 0) + 1 }, unseen: without(s.unseen, id) }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ viewing: { ...s.viewing, [id]: Math.max(0, (s.viewing[id] ?? 0) - 1) } }));
    };
  },

  forget(id) {
    set((s) => ({ unseen: without(s.unseen, id) }));
  },
}));

/** How many threads have something unseen. */
export const unreadCount = (s: Pick<UnreadState, "unseen">): number => Object.keys(s.unseen).length;

/** How many threads work now. */
export const workingCount = (s: { threads: Record<string, Thread> }): number => Object.values(s.threads).filter((t) => t.streaming).length;

/** While the calling component is mounted, it shows `id`: that thread is seen. */
export function useViewing(id: string | null | undefined): void {
  useEffect(() => {
    if (!id) return;
    return useUnread.getState().view(id);
  }, [id]);
}

export const STATUS_WORDS = { working: "Working", waiting: "Waiting", paused: "Paused", interrupted: "Interrupted", done: "Done", failed: "Failed", idle: "" } as const;
