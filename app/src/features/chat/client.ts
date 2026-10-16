// How the chat reaches its backend: Tauri commands inside the app, which
// run every change through kasten-core's ops in the chat's own agent
// session, or the browser preview's stand-in (preview/fake-chat.ts).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inTauri } from "../../lib/api";
import { isoDay } from "../../lib/dates";
import type { NoteFile } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import type { ModelCapabilities } from "./capabilities";
import type { AttachKind, AttachmentInfo, ChatBudgets, ChatSnapshot, LoadedThread, RequestOutcome, ThreadSummary } from "./agent-types";
import { lazyPreviewChat } from "./preview/lazy-chat";
import type { ActionCatalog, ActionRun, ApplyResult, Brainstormed, BrainstormRequest, ChangesView, ChatEvent, ChatProvider, ChatRequest, ChatTurn, ProviderCheck, ProviderDraft, Recalculated, WriteRequest, Written } from "./types";

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
  /** What the provider's model takes: reasoning effort, thinking budget,
   * temperature, longest answer. */
  modelCapabilities(provider: string, model: string): Promise<ModelCapabilities>;
  /** "Test connection" before saving, with the key typed, if any. */
  testProviderDraft(provider: ProviderDraft, key: string | null): Promise<ProviderCheck>;
  /** Writes for the page editor: one answer without tools, its text
   * passed to `onText` as it comes. Nothing is saved: the editor shows it
   * and the person decides. */
  write(request: WriteRequest, onText: (text: string) => void): Promise<Written>;
  /** Stops a write; `write` resolves with what came. */
  stopWrite(id: string): Promise<void>;
  /** The AI actions on offer: the ones built in and the vault's own. */
  aiActions(): Promise<ActionCatalog>;
  /** Runs an action as `write` runs the editor's own: one answer without
   * tools, its text passed to `onText`, stopped with `stopWrite`. */
  runAction(run: ActionRun, onText: (text: string) => void): Promise<Written>;
  /** Starts a turn and returns at once; the answer streams as events. */
  send(request: ChatRequest): Promise<ChatTurn>;
  /** Stops the turn under way; a done event with `stopped` follows. */
  stop(chat: string): Promise<void>;
  /** Forgets the thread: its next turn starts a new session. */
  reset(chat: string): Promise<void>;
  /** Takes the thread back to its first `keep` questions, for asking the
   * last again or another way; the session and what it changed stay. */
  rewind(chat: string, keep: number): Promise<number>;
  /** What the thread has staged for the person to review: each file before
   * and after. Empty when it has staged nothing (or writes directly). */
  changes(chat: string): Promise<ChangesView>;
  /** Writes what the thread staged, as one commit approved by the person;
   * or says which files changed since in a way that cannot be put together
   * with the chat's change, and writes nothing. */
  applyChanges(chat: string): Promise<ApplyResult>;
  /** Plans the staged steps again on the vault as it is now. */
  recalcChanges(chat: string): Promise<Recalculated>;
  /** Throws away what the thread staged. The vault is not touched. */
  discardChanges(chat: string): Promise<void>;
  /** Keeps a file's bytes (text, or a picture of a size a model takes) for a
   * message to name in `attachments`. */
  attach(name: string, kind: AttachKind, bytes: Uint8Array): Promise<AttachmentInfo>;
  /** An attachment's bytes, to show it again. */
  attachment(id: string): Promise<Uint8Array>;
  /** Lets go of an attachment no message holds. */
  dropAttachment(id: string): Promise<void>;
  /** Carries on a paused or interrupted turn in place, with a fresh budget. */
  continueTurn(chat: string): Promise<ChatTurn | null>;
  /** The saved threads of this vault, the latest first. */
  threads(): Promise<ThreadSummary[]>;
  /** A saved thread: the window's own copy of it, and where the backend is with it. */
  load(chat: string): Promise<LoadedThread>;
  /** Saves the window's copy of a thread (messages, chips, plan, settings). */
  saveUi(chat: string, ui: unknown): Promise<void>;
  /** What a thread did since `sinceSeq`, for a window that was away. */
  state(chat: string, sinceSeq: number): Promise<ChatSnapshot>;
  /** Removes a saved thread and the attachments only it held. */
  deleteThread(chat: string): Promise<void>;
  budgets(): Promise<ChatBudgets>;
  setBudgets(budgets: ChatBudgets): Promise<void>;
  /** The last requests, as the connection report shows them. */
  diagnostics(): Promise<RequestOutcome[]>;
  clearDiagnostics(): Promise<void>;
  /** Keeps a transcript as a note in chats/. */
  save(title: string, markdown: string): Promise<NoteFile>;
  /** Asks the model for ideas and places them on the board as cards in a
   * new section, in a session of their own. */
  brainstorm(request: BrainstormRequest): Promise<Brainstormed>;
  /** Listens for every thread's events; returns how to stop. */
  onEvent(listener: (event: ChatEvent) => void): () => void;
}

/** Runs `ask`, passing the text of the answer written for request `id` to
 * `onText` as it comes. The text arrives as events to this window, named by
 * the request; the answer `ask` returns is the whole of it, so a late piece
 * costs nothing. */
async function streamed(id: string, onText: (text: string) => void, ask: () => Promise<Written>): Promise<Written> {
  const stop = await listen<{ id: string; text: string }>("ai-write-text", (e) => {
    if (e.payload.id === id) onText(e.payload.text);
  });
  try {
    return await ask();
  } finally {
    stop();
  }
}

/** Bytes the backend sent, which arrive as a buffer or as a list of numbers. */
const bytesOf = (data: ArrayBuffer | number[]): Uint8Array => (Array.isArray(data) ? Uint8Array.from(data) : new Uint8Array(data));

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
    modelCapabilities: (provider, model) => invoke<ModelCapabilities>("model_capabilities", { provider, model }),
    testProviderDraft: (provider, key) => invoke<ProviderCheck>("test_provider_draft", { provider, key }),
    // The text comes as events to this window, named by the request: the
    // answer in `Written` is the whole of it, so a late piece costs nothing.
    write: (request, onText) => streamed(request.id, onText, () => invoke<Written>("ai_write", { request })),
    stopWrite: (id) => invoke<void>("ai_write_stop", { id }),
    aiActions: () => invoke<ActionCatalog>("ai_actions"),
    runAction: (run, onText) => streamed(run.id, onText, () => invoke<Written>("ai_action_run", { request: run })),
    send: async (request) => {
      await listening;
      return invoke<ChatTurn>("chat_send", { request: { ...request, date: request.date ?? isoDay(new Date()) } });
    },
    stop: (chat) => invoke<void>("chat_stop", { chat }),
    reset: (chat) => invoke<void>("chat_reset", { chat }),
    rewind: (chat, keep) => invoke<number>("chat_rewind", { chat, keep }),
    changes: (chat) => invoke<ChangesView>("chat_changes", { chat }),
    applyChanges: (chat) => invoke<ApplyResult>("chat_apply_changes", { chat }),
    recalcChanges: (chat) => invoke<Recalculated>("chat_recalc_changes", { chat }),
    discardChanges: (chat) => invoke<void>("chat_discard_changes", { chat }),
    // The bytes are the request's body, as for a page's file (`save_asset`); the name travels in a header.
    attach: (name, kind, bytes) => invoke<AttachmentInfo>("chat_attach", bytes, { headers: { "x-name": encodeURIComponent(name), "x-kind": kind } }),
    attachment: async (id) => bytesOf(await invoke<ArrayBuffer | number[]>("chat_attachment", { id })),
    dropAttachment: (id) => invoke<void>("chat_attachment_drop", { id }),
    continueTurn: async (chat) => (await invoke<ChatTurn | null>("chat_continue", { id: chat })) ?? null,
    threads: () => invoke<ThreadSummary[]>("chat_threads"),
    load: (chat) => invoke<LoadedThread>("chat_load", { id: chat }),
    saveUi: (chat, ui) => invoke<void>("chat_save_ui", { id: chat, ui }),
    state: (chat, sinceSeq) => invoke<ChatSnapshot>("chat_state", { id: chat, sinceSeq }),
    deleteThread: (chat) => invoke<void>("chat_delete_thread", { id: chat }),
    budgets: () => invoke<ChatBudgets>("chat_budgets"),
    setBudgets: (budgets) => invoke<void>("set_chat_budgets", { budgets }),
    diagnostics: () => invoke<RequestOutcome[]>("chat_diagnostics"),
    clearDiagnostics: () => invoke<void>("clear_chat_diagnostics"),
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
 * everywhere else (loaded when first used, so the app never carries it). */
export function connectChat(): ChatClient {
  return inTauri() ? tauriChat() : lazyPreviewChat(() => useWorkspace.getState().client);
}
