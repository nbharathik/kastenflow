// What the window knows of the extension's door: the app's latest answer, kept
// here so Settings, the sidebar's Captures entry and the palette agree. Every
// change goes through the app; this only holds what it said last.

import { useEffect } from "react";
import { create } from "zustand";

import { extensionBackend } from "./backend";
import type { ExtensionBackend, ExtensionStatus } from "./types";

interface ExtensionState {
  /** The app's last answer; null until it has answered once. */
  status: ExtensionStatus | null;
  /** When that answer came, to count a code's seconds down from. */
  at: number;
  /** Why the last change failed. */
  problem: string | null;
  refresh(): Promise<void>;
  /** Runs one of the backend's changes and keeps its answer. */
  change(run: (backend: ExtensionBackend) => Promise<ExtensionStatus>): Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useExtension = create<ExtensionState>()((set) => ({
  status: null,
  at: 0,
  problem: null,
  async refresh() {
    try {
      set({ status: await extensionBackend().status(), at: Date.now(), problem: null });
    } catch (err) {
      set({ problem: message(err) });
    }
  },
  async change(run) {
    try {
      set({ status: await run(extensionBackend()), at: Date.now(), problem: null });
    } catch (err) {
      set({ problem: message(err) });
    }
  },
}));

let loading = false;

/** Whether the door is switched on, for views that list it; reads the app's answer once. */
export function useExtensionOn(): boolean {
  const on = useExtension((s) => s.status?.enabled ?? false);
  useEffect(() => {
    if (useExtension.getState().status !== null || loading) return;
    loading = true;
    void useExtension.getState().refresh();
  }, []);
  return on;
}

/** For tests: forgets what the app said, and that it was asked. */
export function resetExtension(): void {
  loading = false;
  useExtension.setState({ status: null, at: 0, problem: null });
}

/** The seconds a pairing code has left, counted down from when the app said. */
export function secondsLeft(status: ExtensionStatus | null, at: number, now: number): number {
  if (!status?.pairing) return 0;
  // A clock read before the answer came has not run yet.
  return Math.max(0, status.pairing.secondsLeft - Math.max(0, Math.floor((now - at) / 1000)));
}
