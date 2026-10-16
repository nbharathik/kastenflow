// Threads that outlive the window. A thread with something in it is written
// (the window's copy, `chat_save_ui`) when a message is sent, when its turn
// ends, and as it changes; the saved threads of the vault are listed when the
// chat starts; one is brought back when it is opened, or when an event names a
// chat this window does not know (a window that was reloaded while it worked).

import type { StoreApi } from "zustand";

import type { ThreadSummary } from "./agent-types";
import type { ChatClient } from "./client";
import { Persister, blobOf, reconcile, restore } from "./saved-thread";
import type { ChatState } from "./store";
import type { Thread } from "./thread";
import type { ChatEvent } from "./types";

/** The events kept for a chat the window is still loading. */
const MOST_BUFFERED = 5000;

const bySeq = (a: ChatEvent, b: ChatEvent) => (a.seq ?? 0) - (b.seq ?? 0);

export interface Persistence {
  /** Starts writing threads through `client`, or stops (null). */
  watch(client: ChatClient | null): void;
  /** Writes what changed now (one thread, or all) and waits for it. */
  flush(id?: string): Promise<void>;
  loadSaved(): Promise<void>;
  adopt(id: string): Promise<boolean>;
  removeSaved(id: string): Promise<boolean>;
  /** An event for a chat the window does not have: it is kept while the chat is loaded. */
  unknown(event: ChatEvent): void;
  /** Takes in what a thread missed. */
  catchUp(id: string): Promise<void>;
  /** A thread was removed here: nothing of it comes back. */
  gone(id: string): void;
}

let active: Persistence | null = null;

/** Writes what changed now and waits for it (a test, or before the window closes). */
export const flushSaves = (): Promise<void> => active?.flush() ?? Promise.resolve();

export function persistence(api: StoreApi<ChatState>, fold: (events: ChatEvent[]) => void): Persistence {
  const get = api.getState;
  const set = api.setState;
  let writer: Persister | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopHiding: (() => void) | null = null;
  const loading = new Map<string, Promise<boolean>>();
  const buffered = new Map<string, ChatEvent[]>();
  /** Chats that could not be loaded, or were removed here: their events are left alone. */
  const ignored = new Set<string>();
  /** Threads just brought back: writing them again would change nothing. */
  const fresh = new WeakSet<Thread>();

  function watch(client: ChatClient | null): void {
    unsubscribe?.();
    stopHiding?.();
    writer?.dispose();
    unsubscribe = null;
    stopHiding = null;
    writer = null;
    loading.clear();
    buffered.clear();
    ignored.clear();
    if (!client) return;
    const mine = new Persister(async (id) => {
      const thread = get().threads[id];
      if (thread && thread.messages.length > 0) await client.saveUi(id, blobOf(thread));
    });
    writer = mine;
    unsubscribe = api.subscribe((state, before) => {
      if (state.threads === before.threads) return;
      for (const [id, thread] of Object.entries(state.threads)) {
        if (thread !== before.threads[id] && thread.messages.length > 0 && !fresh.has(thread)) mine.mark(id);
      }
    });
    // A window that goes out of sight, or away, writes what it has at once.
    const leaving = () => {
      if (document.visibilityState === "hidden") void mine.flush();
    };
    const closing = () => void mine.flush();
    document.addEventListener("visibilitychange", leaving);
    window.addEventListener("pagehide", closing);
    stopHiding = () => {
      document.removeEventListener("visibilitychange", leaving);
      window.removeEventListener("pagehide", closing);
    };
  }

  async function adopt(id: string): Promise<boolean> {
    if (get().threads[id]) return true;
    const going = loading.get(id);
    if (going) return going;
    const client = get().client;
    if (!client || ignored.has(id)) return false;
    const task = (async () => {
      try {
        const loaded = await client.load(id);
        const thread = restore(id, loaded);
        // What happened after the copy was written: the events from its place on.
        const snapshot = await client.state(id, loaded.seq).catch(() => null);
        fresh.add(thread);
        set((s) => ({ threads: { ...s.threads, [id]: thread }, order: s.order.includes(id) ? s.order : [...s.order, id] }));
        const events = [...(snapshot?.events ?? []), ...(buffered.get(id) ?? [])].sort(bySeq);
        buffered.delete(id);
        fold(events);
        const now = get().threads[id];
        if (now) set((s) => ({ threads: { ...s.threads, [id]: reconcile(now, loaded.status) } }));
        return true;
      } catch {
        ignored.add(id);
        buffered.delete(id);
        return false;
      } finally {
        loading.delete(id);
      }
    })();
    loading.set(id, task);
    return task;
  }

  return {
    watch,

    flush: (id) => writer?.flush(id) ?? Promise.resolve(),

    async loadSaved() {
      const client = get().client;
      if (!client) return;
      let list: ThreadSummary[];
      try {
        list = await client.threads();
      } catch {
        return;
      }
      if (get().client !== client) return;
      set({ saved: Object.fromEntries(list.map((s) => [s.id, s])), savedLoaded: true });
      // What still works is taken up now, so the dot says so.
      for (const s of list) if (s.status === "running") void adopt(s.id);
    },

    adopt,

    async removeSaved(id) {
      const client = get().client;
      if (!client) return false;
      try {
        await client.deleteThread(id);
      } catch {
        return false;
      }
      set((s) => {
        const saved = { ...s.saved };
        delete saved[id];
        return { saved };
      });
      return true;
    },

    unknown(event) {
      if (ignored.has(event.chat)) return;
      const held = buffered.get(event.chat) ?? [];
      if (held.length < MOST_BUFFERED) buffered.set(event.chat, [...held, event]);
      void adopt(event.chat);
    },

    async catchUp(id) {
      const client = get().client;
      const seq = get().threads[id]?.seq;
      if (!client || seq === undefined) return;
      const snapshot = await client.state(id, seq).catch(() => null);
      if (snapshot) fold(snapshot.events);
    },

    gone(id) {
      ignored.add(id);
      buffered.delete(id);
    },
  };
}

/** The persistence the store made last, for `flushSaves`. */
export function setActive(p: Persistence): void {
  active = p;
}
