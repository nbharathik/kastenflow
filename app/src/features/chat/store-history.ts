// The store's actions for a chat's place in the list and on the page: a new
// chat that leaves the old one in the list, bringing an archived chat back,
// deleting archived ones (the one thing that asks first), and the tie between
// a chat and the page, deck, diagram or document it is about. The backend
// keeps all of it (chat_new_thread, chat_unarchive, chat_delete_archived,
// chat_bind); this keeps the window's copy of the answer.

import type { StoreApi } from "zustand";

import { useWorkspace } from "../workspace/store";
import type { Binding } from "./agent-types";
import type { Persistence } from "./store-persist";
import type { ChatState } from "./store";
import { useUnread } from "./unread";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Chats that get their tie once the first message is sent, by thread. */
const pending = new Map<string, Binding>();

type History = Pick<ChatState, "newThreadFrom" | "archive" | "unarchive" | "deleteArchived" | "bind" | "unbind" | "bindWhenSent" | "bindIfPending" | "retryOpen" | "retryAdopt" | "leaveFailed">;

export function historyActions(api: StoreApi<ChatState>, kept: Persistence): History {
  const { getState: get, setState: set } = api;

  /** Changes one thread of the window and its entry in the saved list. */
  const patch = (id: string, change: { archived?: boolean; bound?: Binding | null }) =>
    set((s) => {
      const thread = s.threads[id];
      const saved = s.saved[id];
      return {
        ...(thread ? { threads: { ...s.threads, [id]: { ...thread, ...change } } } : {}),
        ...(saved ? { saved: { ...s.saved, [id]: { ...saved, ...change } } } : {}),
      };
    });

  return {
    async newThreadFrom(from, options = {}) {
      let id: string | undefined;
      let bound: Binding | null | undefined;
      try {
        const made = await get().ensure().newThread(from ?? undefined);
        id = made.id;
        bound = made.bound;
      } catch {
        // A local id works too: the backend learns it with the first message.
      }
      // The tie moved to the new chat; the old one stays in the list.
      if (from && bound) patch(from, { bound: null });
      const made = get().start({ ...options, ...(id ? { id } : {}), open: options.open ?? true });
      if (bound) patch(made, { bound });
      return made;
    },

    async archive(id) {
      try {
        await get().ensure().archive(id);
      } catch (err) {
        // A chat that is answering is refused: it says so and stays where it is.
        useWorkspace.getState().toast(message(err));
        return false;
      }
      // A chat's tie is cut when it goes to Archived.
      patch(id, { archived: true, bound: null });
      return true;
    },

    async unarchive(id) {
      try {
        const was = await get().ensure().unarchive(id);
        patch(id, { archived: false });
        return was;
      } catch (err) {
        useWorkspace.getState().toast(message(err));
        return false;
      }
    },

    async deleteArchived(ids) {
      const result = await get().ensure().deleteArchived(ids);
      for (const id of result.deleted) {
        kept.gone(id);
        useUnread.getState().forget(id);
      }
      set((s) => {
        const gone = new Set(result.deleted);
        const threads = Object.fromEntries(Object.entries(s.threads).filter(([id]) => !gone.has(id)));
        const saved = Object.fromEntries(Object.entries(s.saved).filter(([id]) => !gone.has(id)));
        return { threads, saved, order: s.order.filter((id) => !gone.has(id)), active: s.active && gone.has(s.active) ? null : s.active };
      });
      return result;
    },

    async bind(id, target) {
      try {
        const lost = await get().ensure().bind(id, target);
        for (const other of lost) patch(other, { bound: null });
        patch(id, { bound: target, archived: false });
        return true;
      } catch (err) {
        useWorkspace.getState().toast(message(err));
        return false;
      }
    },

    async unbind(id) {
      try {
        await get().ensure().unbind(id);
        patch(id, { bound: null });
        return true;
      } catch (err) {
        useWorkspace.getState().toast(message(err));
        return false;
      }
    },

    bindWhenSent(id, target) {
      pending.set(id, target);
    },

    async bindIfPending(id) {
      const target = pending.get(id);
      if (!target) return;
      pending.delete(id);
      await get().bind(id, target);
    },

    retryAdopt: (id) => kept.retry(id),

    async retryOpen(id) {
      const there = await kept.retry(id);
      if (there) set({ active: id, failedOpen: null });
      return there;
    },

    leaveFailed() {
      set({ failedOpen: null });
    },
  };
}
