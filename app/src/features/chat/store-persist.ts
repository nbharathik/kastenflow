// Threads that outlive the window. A thread with something in it is written
// (the window's copy, `chat_save_ui`) when a message is sent, when its turn
// ends, and as it changes; the saved threads of the vault are listed when the
// chat starts; one is brought back when it is opened, or when an event names a
// chat this window does not know (a window that was reloaded while it worked).

import type { StoreApi } from "zustand";

import { adoptFailureOf, type AdoptFailure, type ThreadSummary } from "./agent-types";
import type { ChatClient } from "./client";
import { Persister, blobOf, reconcile, restore } from "./saved-thread";
import type { ChatState } from "./store";
import type { Thread } from "./thread";
import type { ChatEvent } from "./types";

/** The events kept for a chat the window is still loading. */
const MOST_BUFFERED = 5000;

const bySeq = (a: ChatEvent, b: ChatEvent) => (a.seq ?? 0) - (b.seq ?? 0);

/** `map` without `id`. */
function without(map: Record<string, AdoptFailure>, id: string): Record<string, AdoptFailure> {
  const next = { ...map };
  delete next[id];
  return next;
}

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
  /** Takes in what a thread missed; when the backend can no longer replay it all, the thread is read again. */
  catchUp(id: string): Promise<void>;
  /** Tries a chat that could not be reopened once more. Whether it is there now. */
  retry(id: string): Promise<boolean>;
  /** A thread was removed here: nothing of it comes back. */
  gone(id: string): void;
  /** A chat put away here may be brought in again (the person opened it). */
  allow(id: string): void;
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
  /** Chats that were removed here: their events are left alone. */
  const ignored = new Set<string>();
  /** Chats that could not be reopened: left alone until the person retries. */
  const failed = new Set<string>();
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
    failed.clear();
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
    if (!client || ignored.has(id) || failed.has(id)) return false;
    const task = (async () => {
      try {
        const loaded = await client.load(id);
        const thread = restore(id, loaded);
        // What happened after the copy was written: the events from its place on. Past a gap
        // the backend cannot replay them all, and half of them would leave the screen wrong:
        // the saved screen and the conversation are shown as they are.
        const snapshot = loaded.gap ? null : await client.state(id, loaded.seq).catch(() => null);
        fresh.add(thread);
        set((s) => ({ threads: { ...s.threads, [id]: thread }, order: s.order.includes(id) ? s.order : [...s.order, id] }));
        // A gap in the backend's ring (`gap` on the snapshot) is the same: nothing of it is replayed.
        const replay = snapshot?.gap ? [] : (snapshot?.events ?? []);
        const events = [...replay, ...(loaded.gap ? [] : (buffered.get(id) ?? []))].sort(bySeq);
        buffered.delete(id);
        fold(events);
        const now = get().threads[id];
        if (now) set((s) => ({ threads: { ...s.threads, [id]: reconcile(now, loaded.status) } }));
        if (get().adoptFailures[id]) set((s) => without(s.adoptFailures, id));
        return true;
      } catch (err) {
        // Never an empty new thread: the person is told, and offered Retry or a new chat.
        failed.add(id);
        buffered.delete(id);
        const failure = adoptFailureOf(err) ?? { kind: "adoptFailed" as const, reason: "missing" as const, message: "This chat could not be opened." };
        set((s) => ({ adoptFailures: { ...s.adoptFailures, [id]: failure } }));
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
      set((s) => {
        // A thread already in the window learns whether it is archived or tied from the list.
        const threads = { ...s.threads };
        for (const found of list) {
          const there = threads[found.id];
          if (there && ((there.archived ?? false) !== (found.archived ?? false) || JSON.stringify(there.bound ?? null) !== JSON.stringify(found.bound ?? null))) {
            threads[found.id] = { ...there, archived: found.archived ?? false, bound: found.bound ?? null };
            // The tie and the archive live on the backend: this is not a change to write.
            fresh.add(threads[found.id]!);
          }
        }
        return { saved: Object.fromEntries(list.map((one) => [one.id, one])), savedLoaded: true, threads };
      });
      // What still works (or waits for a place) is taken up now, so the dot says so.
      for (const s of list) if (s.status === "running" || s.status === "waiting") void adopt(s.id);
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
      if (ignored.has(event.chat) || failed.has(event.chat)) return;
      const held = buffered.get(event.chat) ?? [];
      if (held.length < MOST_BUFFERED) buffered.set(event.chat, [...held, event]);
      void adopt(event.chat);
    },

    async catchUp(id) {
      const client = get().client;
      const seq = get().threads[id]?.seq;
      if (!client || seq === undefined) return;
      const snapshot = await client.state(id, seq).catch(() => null);
      if (!snapshot) return;
      if (!snapshot.gap) return fold(snapshot.events);
      // Some events were dropped: the thread is read again, and shown as the backend has it.
      try {
        const loaded = await client.load(id);
        const thread = reconcile(restore(id, loaded), loaded.status);
        fresh.add(thread);
        set((s) => (s.threads[id] ? { threads: { ...s.threads, [id]: thread } } : s));
      } catch {
        // What the window has stays.
      }
    },

    retry(id) {
      failed.delete(id);
      set((s) => without(s.adoptFailures, id));
      return adopt(id);
    },

    gone(id) {
      ignored.add(id);
      buffered.delete(id);
    },

    allow(id) {
      ignored.delete(id);
    },
  };
}

/** The persistence the store made last, for `flushSaves`. */
export function setActive(p: Persistence): void {
  active = p;
}
