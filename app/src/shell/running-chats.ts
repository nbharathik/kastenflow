// The running-agents popover on the Chat button: whether it is open, and what it lists. The store is tiny so that the window's top
// right can ask without loading the chat; the list itself (RunningChats.tsx) loads when the popover opens.

import { create } from "zustand";

import type { Thread, ThreadStatus } from "../features/chat/thread";

interface RunningState {
  open: boolean;
  show(open?: boolean): void;
}

export const useRunningChats = create<RunningState>()((set) => ({
  open: false,
  show: (open) => set((s) => ({ open: open ?? !s.open })),
}));

/** The states in which a chat is still doing something or is waiting for the person: what the list is about. */
const RUNNING: readonly ThreadStatus[] = ["working", "waiting", "paused", "interrupted"];

export interface RunningRow {
  id: string;
  status: ThreadStatus;
  title: string;
  /** The document the chat is tied to, when it is. */
  bound: { kind: string; path: string } | null;
}

/** The chats that work or stopped short, those that work first, then by how long ago they were made (newest first). */
export function runningRows(threads: Record<string, Thread>, status: (thread: Thread) => ThreadStatus, title: (thread: Thread) => string): RunningRow[] {
  return Object.values(threads)
    .filter((t) => RUNNING.includes(status(t)))
    .sort((a, b) => Number(status(b) === "working") - Number(status(a) === "working") || b.created - a.created)
    .map((t) => ({ id: t.id, status: status(t), title: title(t), bound: t.bound ? { kind: t.bound.kind, path: t.bound.path } : null }));
}
