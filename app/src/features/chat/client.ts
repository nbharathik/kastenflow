// How the chat reaches its backend: Tauri commands inside the app, which
// run every change through kasten-core's ops in the chat's own agent
// session, or the browser preview's stand-in (preview/fake-chat.ts).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inTauri } from "../../lib/api";
import { isoDay } from "../../lib/dates";
import type { NoteFile } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { previewChat } from "./preview/fake-chat";
import type { Brainstormed, BrainstormRequest, ChatEvent, ChatProvider, ChatRequest, ChatTurn, ProviderCheck, ProviderDraft, WriteRequest, Written } from "./types";

export interface ChatClient {
  /** `app` through the core, `preview` for the browser's stand-in. */
  readonly kind: "app" | "preview";
  providers(): Promise<ChatProvider[]>;
  /** Adds or changes a provider. `key`: null keeps the stored key, "" deletes
   * it, anything else is stored in the system keychain. */
  saveProvider(provider: ProviderDraft, key: string | null): Promise<ChatProvider[]>;
  /** Removes a provider and its key. */
  removeProvider(name: string): Promise<ChatProvider[]>;
  /** Confirms on this computer the address a provider in the vault's
   * settings sends notes to. */
  confirmProvider(name: string): Promise<ChatProvider[]>;
  /** Sends one short request to the provider's model (or `model`) and says how it went. */
  testProvider(name: string, model?: string | null): Promise<ProviderCheck>;
  /** The models a provider being set up offers. `key` is the one typed in
   * the form, used for this request only; null asks with the stored key. */
  listProviderModels(provider: ProviderDraft, key: string | null): Promise<string[]>;
  /** "Test connection" before saving, with the key typed, if any. */
  testProviderDraft(provider: ProviderDraft, key: string | null): Promise<ProviderCheck>;
  /** Writes for the page editor: one answer without tools, its text
   * passed to `onText` as it comes. Nothing is saved: the editor shows it
   * and the person decides. */
  write(request: WriteRequest, onText: (text: string) => void): Promise<Written>;
  /** Stops a write; `write` resolves with what came. */
  stopWrite(id: string): Promise<void>;
  /** Starts a turn and returns at once; the answer streams as events. */
  send(request: ChatRequest): Promise<ChatTurn>;
  /** Stops the turn under way; a done event with `stopped` follows. */
  stop(chat: string): Promise<void>;
  /** Forgets the thread: its next turn starts a new session. */
  reset(chat: string): Promise<void>;
  /** Keeps a transcript as a note in chats/. */
  save(title: string, markdown: string): Promise<NoteFile>;
  /** Asks the model for ideas and places them on the board as cards in a
   * new section, in a session of their own. */
  brainstorm(request: BrainstormRequest): Promise<Brainstormed>;
  /** Listens for every thread's events; returns how to stop. */
  onEvent(listener: (event: ChatEvent) => void): () => void;
}

export function tauriChat(): ChatClient {
  // An answer's first events could come before the listener is registered;
  // a turn starts only once it is.
  let listening: Promise<unknown> = Promise.resolve();
  return {
    kind: "app",
    providers: () => invoke<ChatProvider[]>("chat_providers"),
    saveProvider: (provider, key) => invoke<ChatProvider[]>("save_chat_provider", { provider, key }),
    removeProvider: (name) => invoke<ChatProvider[]>("remove_chat_provider", { name }),
    confirmProvider: (name) => invoke<ChatProvider[]>("confirm_chat_provider", { name }),
    testProvider: (name, model) => invoke<ProviderCheck>("test_chat_provider", { name, model: model ?? null }),
    listProviderModels: (provider, key) => invoke<string[]>("list_provider_models", { provider, key }),
    testProviderDraft: (provider, key) => invoke<ProviderCheck>("test_provider_draft", { provider, key }),
    // The text comes as events to this window, named by the request: the
    // answer in `Written` is the whole of it, so a late piece costs nothing.
    write: async (request, onText) => {
      const stop = await listen<{ id: string; text: string }>("ai-write-text", (e) => {
        if (e.payload.id === request.id) onText(e.payload.text);
      });
      try {
        return await invoke<Written>("ai_write", { request });
      } finally {
        stop();
      }
    },
    stopWrite: (id) => invoke<void>("ai_write_stop", { id }),
    send: async (request) => {
      await listening;
      return invoke<ChatTurn>("chat_send", { request: { ...request, date: request.date ?? isoDay(new Date()) } });
    },
    stop: (chat) => invoke<void>("chat_stop", { chat }),
    reset: (chat) => invoke<void>("chat_reset", { chat }),
    // The file is named by the person's day, not UTC's.
    save: (title, markdown) => invoke<NoteFile>("save_chat", { title, markdown, date: isoDay(new Date()) }),
    brainstorm: (request) => invoke<Brainstormed>("brainstorm_board", { ...request }),
    onEvent(listener) {
      const stop = listen<ChatEvent>("chat-event", (e) => listener(e.payload));
      listening = stop.catch(() => {});
      return () => void stop.then((fn) => fn(), () => {});
    },
  };
}

/** The chat backend for this window, picked as vault.ts picks the vault:
 * the app's inside Tauri, the preview's stand-in on the preview vault
 * everywhere else. */
export function connectChat(): ChatClient {
  return inTauri() ? tauriChat() : previewChat(() => useWorkspace.getState().client);
}
