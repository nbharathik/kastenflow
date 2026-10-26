// The window's chats: every thread this session, the one the Chat view and
// the dock show, and the AI providers.
// Events from the backend fold into threads (thread.ts); streamed text
// waits for the next frame (stream.ts). A thread with something in it is
// kept on the backend between runs (store-persist.ts): it is listed when the
// chat starts and brought back when opened, and a chat that works while the
// window is away is picked up again where it is.

import { create } from "zustand";

import { useWorkspace } from "../workspace/store";
import type { AdoptFailure, Binding, DeletedArchived, ThreadSummary } from "./agent-types";
import { forgetCapabilities } from "./capabilities";
import { connectChat, type ChatClient } from "./client";
import { keepModel, keepSettings, modelFor } from "./prefs";
import { outcomeOf, touched } from "./store-events";
import { fieldActions } from "./store-fields";
import { historyActions } from "./store-history";
import { redoActions } from "./store-redo";
import { learnFromTrial, trials } from "./store-learn";
import { persistence, setActive } from "./store-persist";
import { selectionActions } from "./store-selection";
import { sendActions } from "./store-send";
import { FrameQueue } from "./stream";
import { applyEvent, endTurn, newThread, type Chip, type SentAttachment, type Thread } from "./thread";
import type { ChangesInfo, ChatEvent, ChatProvider, GenerationSettings, ProviderDraft } from "./types";
import { useUnread, workingCount } from "./unread";

export { flushSaves } from "./store-persist";

export interface ChatState {
  client: ChatClient | null;
  /** Null until read. */
  providers: ChatProvider[] | null;
  /** Why they could not be read. */
  providersError: string | null;
  threads: Record<string, Thread>;
  /** Thread ids, the latest used first. */
  order: string[];
  /** The thread the Chat view and the dock show. */
  active: string | null;
  /** Counts what turns have found out about a model (a reasoning effort it
   * took or refused), so the pickers read what was kept again. */
  learned: number;
  /** The vault's saved threads that are not (or not yet) in this window, by id. */
  saved: Record<string, ThreadSummary>;
  /** Whether the saved threads have been read. */
  savedLoaded: boolean;
  /** Saved chats that could not be reopened, by id, and why. */
  adoptFailures: Record<string, AdoptFailure>;
  /** The saved chat the person tried to open and could not: the view says so instead of showing a thread. */
  failedOpen: string | null;

  /** The backend, connected on first use. */
  ensure(): ChatClient;
  connect(client: ChatClient | null): void;
  loadProviders(): Promise<void>;
  /** Reads the vault's saved threads; those still working are picked up at once. */
  loadSaved(): Promise<void>;
  /** Rejects with the backend's reason. */
  saveProvider(provider: ProviderDraft, key: string | null): Promise<void>;
  removeProvider(name: string): Promise<void>;
  confirmProvider(name: string): Promise<void>;
  /** A new thread, shown at once with `open`. Its page chip follows the page
   * being looked at unless `follow` is false (a thread about one page). */
  start(options?: { id?: string; context?: Chip[]; open?: boolean; follow?: boolean }): string;
  /** A new chat the backend knows: `from` stays in the list and its tie (to a page, deck…) moves to the new one. The id of the new chat. */
  newThreadFrom(from: string | null, options?: { context?: Chip[]; open?: boolean; follow?: boolean }): Promise<string>;
  /** Moves a chat to Archived (it stays saved, and "Move back to the list" undoes it). Whether it went; a chat that is answering stays and says so. */
  archive(id: string): Promise<boolean>;
  /** Brings an archived chat back into the list. Whether it was archived. */
  unarchive(id: string): Promise<boolean>;
  /** Deletes the archived chats named, for good; the answer says which went and which were skipped and why. */
  deleteArchived(ids: string[]): Promise<DeletedArchived>;
  /** Ties the thread to a page, deck, diagram or document; whether it worked. Another thread tied to it loses the tie. */
  bind(id: string, target: Binding): Promise<boolean>;
  unbind(id: string): Promise<boolean>;
  /** Ties the thread once its first message is sent (a chat is saved when it has something in it). */
  bindWhenSent(id: string, target: Binding): void;
  bindIfPending(id: string): Promise<void>;
  /** Tries again to open a chat that could not be read. */
  retryOpen(id: string): Promise<boolean>;
  /** Tries again to bring a chat in without showing it (a deck's assistant tab). Whether it is there. */
  retryAdopt(id: string): Promise<boolean>;
  /** Leaves the "could not reopen" notice (to start a new chat). */
  leaveFailed(): void;
  /** The latest selection becomes the thread's automatic selection chip, replacing the one before it. */
  setSelection(id: string, chip: Chip): void;
  /** "Add to chat": keeps the snippet with the thread, up to five. False when the thread is full. */
  keepSelection(id: string, chip: Chip): boolean;
  /** Shows a thread; a saved one is brought in first. */
  open(id: string): void;
  /** Brings a saved thread into the window. Whether it is there. */
  adopt(id: string): Promise<boolean>;
  /** Whether the message went. While the model works it is queued for its next
   * step; not without a provider, text, or while Stop is waited for. */
  send(id: string, text: string, attachments?: SentAttachment[]): Promise<boolean>;
  /** Carries a paused turn on in place with a fresh budget. Whether it did. */
  continueThread(id: string): Promise<boolean>;
  stop(id: string): Promise<void>;
  /** Forgets a thread here and on the backend; whether it did. A thread with
   * staged changes waiting is kept: the person applies or discards them first. */
  discard(id: string): Promise<boolean>;
  /** Removes a saved thread that was never opened here. Whether it went. */
  removeSaved(id: string): Promise<boolean>;
  choose(id: string, provider: string, model: string | null): void;
  /** What the thread's model answers with; remembered for that model. */
  setSettings(id: string, settings: GenerationSettings): void;
  /** Lets pictures go to the thread's model although it is not known to read them. */
  setAllowImages(id: string, allow: boolean): void;
  /** Asks the last question again after a failed answer. Whether it went. */
  retry(id: string): Promise<boolean>;
  /** Asks the last question again, in place of its answer. Whether it went. */
  regenerate(id: string): Promise<boolean>;
  /** Asks `text` in place of the last question and its answer. Whether it went. */
  resend(id: string, text: string): Promise<boolean>;
  addChip(id: string, chip: Chip): void;
  removeChip(id: string, key: string): void;
  /** The page chip becomes the page being looked at (none leaves it as it is); not while the thread does not follow. */
  followPage(id: string, chip: Chip | null): void;
  setFollow(id: string, follow: boolean): void;
  /** Keeps a followed chip through page changes, or lets it follow again. */
  pinChip(id: string, key: string, pinned: boolean): void;
  /** Names the thread; an empty name goes back to its first question. */
  rename(id: string, title: string): void;
  pinned(id: string, message: string, path: string): void;
  /** The thread's session was undone, or (false) the undo was taken back. */
  undone(id: string, undone?: boolean): void;
  /** Whether the thread's writes are made at once ("Apply directly") or wait as staged changes. */
  setDirect(id: string, direct: boolean): void;
  /** What the thread has staged, as the backend last said; none when nothing waits. */
  setChanges(id: string, changes: ChangesInfo | undefined): void;
  /** The thread's staged changes were written: it changed the vault, and nothing waits. */
  applied(id: string): void;
  receive(event: ChatEvent): void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** How long a stopped turn may take to say so before the window ends it. */
const STOP_GRACE_MS = 8000;

let unlisten: (() => void) | null = null;
/** Provider reads cross: the newest one's answer wins. */
let reads = 0;
let queue: FrameQueue<ChatEvent> | null = null;

/** Hands streamed text waiting for the next frame to the store now. */
export const flushStream = () => queue?.flush();

const lastId = (thread: Thread) => thread.messages[thread.messages.length - 1]?.id;

export const useChat = create<ChatState>()((set, get, api) => {
  const update = (id: string, change: (thread: Thread) => Thread) =>
    set((s) => {
      const thread = s.threads[id];
      const next = thread && change(thread);
      return next && next !== thread ? { threads: { ...s.threads, [id]: next } } : s;
    });

  const fold = (events: ChatEvent[]) =>
    set((s) => {
      let threads = s.threads;
      for (const event of events) {
        const thread = threads[event.chat];
        const next = thread && applyEvent(thread, event);
        if (!next || next === thread) continue;
        if (threads === s.threads) threads = { ...threads };
        threads[event.chat] = next;
      }
      return threads === s.threads ? s : { threads };
    });
  queue = new FrameQueue(fold);

  const toFront = (id: string) => set((s) => (s.order[0] === id ? s : { order: [id, ...s.order.filter((o) => o !== id)] }));

  const kept = persistence(api, fold);
  setActive(kept);
  const sending = sendActions(get, update, { flush: () => queue?.flush(), toFront, catchUp: kept.catchUp, save: (id) => void kept.flush(id) });
  // The tie asked for with the first message is made once it went.
  const sent = {
    ...sending,
    async send(...args: Parameters<typeof sending.send>) {
      const went = await sending.send(...args);
      if (went) void get().bindIfPending(args[0]);
      return went;
    },
  };
  // The window's chat button shows that a thread works without loading the chat.
  api.subscribe((s, before) => {
    if (s.threads !== before.threads) useUnread.getState().setWorking(workingCount(s));
  });

  return {
    client: null,
    providers: null,
    providersError: null,
    threads: {},
    order: [],
    active: null,
    learned: 0,
    saved: {},
    savedLoaded: false,
    adoptFailures: {},
    failedOpen: null,

    ensure() {
      const { client } = get();
      if (client) return client;
      const connected = connectChat();
      get().connect(connected);
      return connected;
    },

    connect(client) {
      unlisten?.();
      forgetCapabilities();
      trials.clear();
      unlisten = client ? client.onEvent((event) => get().receive(event)) : null;
      set({ client, providers: null, providersError: null, saved: {}, savedLoaded: false, adoptFailures: {}, failedOpen: null });
      kept.watch(client);
    },

    async loadProviders() {
      const client = get().ensure();
      const read = ++reads;
      try {
        const providers = await client.providers();
        if (read === reads) set({ providers, providersError: null });
      } catch (err) {
        if (read === reads) set((s) => ({ providers: s.providers ?? [], providersError: message(err) }));
      }
    },

    loadSaved() {
      get().ensure();
      return kept.loadSaved();
    },

    async saveProvider(provider, key) {
      const providers = await get().ensure().saveProvider(provider, key);
      reads++;
      set({ providers, providersError: null });
    },

    async removeProvider(name) {
      const providers = await get().ensure().removeProvider(name);
      reads++;
      set({ providers, providersError: null });
    },

    async confirmProvider(name) {
      const providers = await get().ensure().confirmProvider(name);
      reads++;
      set({ providers, providersError: null });
    },

    start({ id, context = [], open = false, follow } = {}) {
      // Chips a thread starts with were chosen, not followed.
      const thread = newThread({ ...(id ? { id } : {}), context: context.map((chip) => ({ ...chip, origin: chip.origin ?? "added" })), follow });
      set((s) => ({
        threads: { ...s.threads, [thread.id]: thread },
        order: [thread.id, ...s.order],
        ...(open ? { active: thread.id, failedOpen: null } : {}),
      }));
      return thread.id;
    },

    open(id) {
      if (get().threads[id]) return set({ active: id, failedOpen: null });
      if (!get().saved[id]) return;
      // A chat put away here (Archived) is the person's to bring back.
      kept.allow(id);
      void kept.adopt(id).then((there) => {
        if (there) set({ active: id, failedOpen: null });
        // Not an empty new thread: the view says it could not be read and offers a way on.
        else if (get().adoptFailures[id]) set({ failedOpen: id });
      });
    },

    adopt: (id) => kept.adopt(id),

    ...sent,
    ...selectionActions(get, update),
    ...historyActions(api, kept),

    async retry(id) {
      const thread = get().threads[id];
      const count = thread?.messages.length ?? 0;
      const failed = thread?.messages[count - 1];
      const asked = thread?.messages[count - 2];
      if (!thread || thread.streaming || failed?.role !== "assistant" || failed.status !== "error" || asked?.role !== "user") return false;
      // An answer that said nothing left no trace in the backend's thread, so
      // the question takes its place instead of standing twice.
      if (failed.parts.length === 0) update(id, (t) => ({ ...t, messages: t.messages.slice(0, -2) }));
      return get().send(id, asked.text, asked.attachments);
    },

    async stop(id) {
      const thread = get().threads[id];
      if (!thread?.streaming) return;
      update(id, (t) => ({ ...t, stopping: true }));
      const answer = lastId(thread);
      const end = () => {
        queue?.flush();
        update(id, (t) => (t.stopping && lastId(t) === answer ? endTurn(t, "stopped") : t));
      };
      try {
        await get().ensure().stop(id);
        setTimeout(end, STOP_GRACE_MS);
      } catch {
        end();
      }
    },

    async discard(id) {
      const thread = get().threads[id];
      if (!thread) return false;
      // What it staged would go with it, unread: the person decides that first.
      if (thread.changes) {
        useWorkspace.getState().toast("Apply or discard this chat's staged changes first");
        return false;
      }
      // A chat with something in it goes to Archived, where it can be found and brought back;
      // nothing is deleted. One that is answering is refused, and stays.
      const written = thread.messages.length > 0 || Boolean(get().saved[id]);
      if (written && !(await get().archive(id))) return false;
      kept.gone(id);
      useUnread.getState().forget(id);
      set((s) => {
        const threads = { ...s.threads };
        delete threads[id];
        const saved = { ...s.saved };
        // An empty chat was never saved; a written one stays listed, now under Archived.
        if (!written) delete saved[id];
        else if (saved[id]) saved[id] = { ...saved[id], archived: true, bound: null };
        return { threads, saved, order: s.order.filter((o) => o !== id), active: s.active === id ? null : s.active };
      });
      // The backend lets it go from memory; the saved copy stays.
      await get()
        .ensure()
        .reset(id)
        .catch(() => {});
      if (written) void kept.loadSaved();
      return true;
    },

    removeSaved: (id) => kept.removeSaved(id),

    choose(id, provider, model) {
      const clean = model?.trim() || null;
      // Another model takes what was last used with it, not this one's settings.
      update(id, (t) => (t.provider === provider && t.model === clean ? t : { ...t, provider, model: clean, settings: undefined }));
      const known = get().providers?.find((p) => p.name === provider);
      if (known) keepModel({ provider, model: clean ?? known.model });
    },

    setSettings(id, settings) {
      const thread = get().threads[id];
      const choice = thread && modelFor(thread, get().providers);
      if (!thread || !choice) return;
      update(id, (t) => ({ ...t, settings }));
      keepSettings(choice.provider, choice.model, settings);
    },

    ...redoActions(get, update),
    ...fieldActions(update),

    receive(raw) {
      // A chat this window does not have: it is loaded, and the event waits for it.
      if (!get().threads[raw.chat]) return kept.unknown(raw);
      // A result without its paths touched none.
      const event = raw.kind === "toolResult" && raw.result && !Array.isArray(raw.result.paths) ? { ...raw, result: { ...raw.result, paths: [] } } : raw;
      if (event.kind === "text") return queue?.push(event);
      // Text that came first goes in first.
      queue?.flush();
      const was = get().threads[event.chat]?.streaming;
      fold([event]);
      // A staged change wrote nothing: there is nothing for lists and open pages to take in yet.
      if (event.kind === "toolResult" && event.result?.ok && !event.result.staged && event.result.paths.length) touched(event.result.paths);
      const outcome = outcomeOf(event);
      if (outcome) {
        // The turn ended: if someone was not looking, the thread says so; its copy is written now.
        if (was && !get().threads[event.chat]?.streaming) useUnread.getState().note(event.chat, outcome);
        void kept.flush(event.chat);
      }
      if (event.kind === "done" || event.kind === "error") {
        const client = get().client;
        if (client) {
          void learnFromTrial(client, event.chat, event.kind === "done" && !event.stopped).then((found) => {
            if (found) set((s) => ({ learned: s.learned + 1 }));
          });
        }
      }
    },
  };
});
