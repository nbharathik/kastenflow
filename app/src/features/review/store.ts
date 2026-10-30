// The review queue: proposals waiting for the owner. The MCP server writes them
// from another process and tells no one, so the app asks: every 20 s while the
// window is visible, when the window gets focus, after every decision, and when
// the vault watcher reports a proposal file.

import { useEffect } from "react";
import { create } from "zustand";

import { startInterval } from "../../lib/use-interval";
import type { Proposal, VaultClient } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { oldestFirst } from "./group";

export const POLL_MS = 20_000;

interface ReviewState {
  /** Pending proposals, oldest first. */
  proposals: Proposal[];
  /** Whether the list has been read at least once. */
  loaded: boolean;
  /** Why the last read failed, if it did. */
  error: string | null;
  refresh(): Promise<void>;
  /** Takes a decided proposal off the list before the next read. */
  drop(id: string): void;
}

export const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reads started; only the latest one's answer counts. */
let reads = 0;

export const useReview = create<ReviewState>()((set) => ({
  proposals: [],
  loaded: false,
  error: null,

  async refresh() {
    const read = ++reads;
    const client = useWorkspace.getState().client;
    if (!client) return set({ proposals: [], loaded: false, error: null });
    try {
      const found = await client.proposals();
      if (read === reads) set({ proposals: oldestFirst(found.filter((p) => p.status === "pending")), loaded: true, error: null });
    } catch (err) {
      if (read === reads) set({ loaded: true, error: message(err) });
    }
  },

  drop(id) {
    set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) }));
  },
}));

const refresh = () => void useReview.getState().refresh();
const PROPOSALS_DIR = ".kasten/proposals/";

/** Reads now, then on the clock, on focus and on coming back into view.
 * Inside the app the vault watcher also reports proposal files as they
 * appear, so the badge need not wait for the clock. */
function startPolling(client: VaultClient): () => void {
  const stopEvery = startInterval(refresh, POLL_MS);
  window.addEventListener("focus", refresh);
  const unwatch = client.watch?.({
    changed(paths) {
      if (paths.some((p) => p.startsWith(PROPOSALS_DIR))) refresh();
    },
    committed() {},
    error() {},
  });
  refresh();
  return () => {
    stopEvery();
    window.removeEventListener("focus", refresh);
    unwatch?.();
  };
}

// Several components may want the count at once; they share one poller,
// started again when the vault changes.
let users = 0;
let poller: { client: VaultClient; stop: () => void } | null = null;

/** Keeps the pending proposals fresh while the calling component is mounted. */
export function useReviewPolling(): void {
  const client = useWorkspace((s) => s.client);
  useEffect(() => {
    if (!client) return;
    users++;
    if (poller?.client === client) refresh();
    else {
      poller?.stop();
      poller = { client, stop: startPolling(client) };
    }
    return () => {
      if (--users > 0) return;
      poller?.stop();
      poller = null;
    };
  }, [client]);
}

/** How many proposals wait, for the sidebar's Review badge; polls while shown. */
export function usePendingCount(): number {
  useReviewPolling();
  return useReview((s) => s.proposals.length);
}
