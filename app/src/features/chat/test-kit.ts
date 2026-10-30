// For the chat's tests: a backend whose answers the test writes event by
// event, and a store emptied between tests.

import type { NoteFile } from "../../lib/vault/types";
import { DEFAULT_BUDGETS, DEFAULT_CHAT_LIMITS, type AttachKind, type Binding, type ChatBudgets, type ChatLimits, type ChatSnapshot, type ImportedBindings, type LoadedThread, type RequestOutcome, type ThreadSummary } from "./agent-types";
import { forgetCapabilities, type ModelCapabilities } from "./capabilities";
import type { ChatClient } from "./client";
import { BUILT_IN_CATALOG } from "./preview/actions";
import { useChat } from "./store";
import type { ActionCatalog, ActionRun, ApplyResult, BrainstormRequest, ChangesView, ChatEvent, ChatProvider, ChatRequest, ChatTurn, ProviderDraft, Recalculated, WriteRequest } from "./types";

export const CLAUDE: ChatProvider = { name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "model-small", hasKey: true, confirmed: true };
export const LOCAL: ChatProvider = { name: "Local server", kind: "openai", baseUrl: "http://local-server:8000/v1", model: "local-model", hasKey: false, confirmed: true };

export interface Scripted extends ChatClient {
  requests: ChatRequest[];
  brainstorms: BrainstormRequest[];
  saved: { provider: ProviderDraft; key: string | null }[];
  /** What model lists and draft tests were asked with. */
  drafts: { provider: ProviderDraft; key: string | null }[];
  /** The models every provider offers. */
  models: string[];
  /** What every model takes; null makes the ask fail, as an unknown provider's would. */
  capabilities: ModelCapabilities | null;
  /** The "provider|model" of each capability ask. */
  capabilityAsks: string[];
  /** What the editor asked AI to write. */
  writes: WriteRequest[];
  /** The AI actions run, and the ones on offer. */
  runs: ActionRun[];
  catalog: ActionCatalog;
  /** The answer every write gives, streamed in two pieces. */
  answer: string;
  /** Holds the next write open until stopped, after its first piece. */
  holdNext(): void;
  stops: string[];
  resets: string[];
  /** The `[chat, keep]` of each time a thread was taken back. */
  rewinds: [string, number][];
  /** What every thread has staged, and what applying and recalculating answer. */
  view: ChangesView;
  applyResult: ApplyResult;
  recalculated: Recalculated;
  /** The threads whose staged changes were applied, recalculated and discarded. */
  applied: string[];
  recalcs: string[];
  discarded: string[];
  /** What was kept with `attach` (the ids are `att-1`, `att-2`…), and the ids let go of. */
  attached: { name: string; kind: AttachKind; bytes: Uint8Array }[];
  dropped: string[];
  /** The saved threads the backend lists, what loading each gives, and what the window saved. */
  threadList: ThreadSummary[];
  loads: Record<string, LoadedThread>;
  uis: { chat: string; ui: unknown }[];
  /** What `state` answers for a thread, and the `[chat, sinceSeq]` of each ask. */
  snapshots: Record<string, ChatSnapshot>;
  stateAsks: [string, number][];
  /** The threads continued and deleted. */
  continues: string[];
  deleted: string[];
  /** What `load` rejects with for a chat (the typed adopt failure, or a plain error). */
  loadErrors: Record<string, unknown>;
  /** The `from` of each `newThread`, the ids it gave, and what it did to others. */
  newThreads: (string | undefined)[];
  /** The ids unarchived, the ids `deleteArchived` was asked for, and the skipped ones it answers with. */
  unarchives: string[];
  /** The ids archived by hand (`archive`). */
  archives: string[];
  archivedDeletes: string[][];
  skipOnDelete: { id: string; reason: string }[];
  limitValues: ChatLimits;
  /** Ties, as `bind` made them (thread to target), the unbound threads, and the moves passed to `rebind`. */
  ties: Record<string, Binding>;
  unbinds: string[];
  rebinds: { from: string; to: string }[][];
  /** What `importBindings` was given (one entry per call), and what it answers. */
  imports: Record<string, string>[];
  imported: ImportedBindings;
  /** The next `send` while a turn runs answers as queued. */
  queueNext(): void;
  budgetValues: ChatBudgets;
  outcomes: RequestOutcome[];
  clearedOutcomes: number;
  /** Sends an event as the backend would. */
  emit(event: ChatEvent): void;
  /** Makes the next send, brainstorm, model list or test fail with this message. */
  failNext(message: string): void;
}

export function scriptedChat(providers: ChatProvider[] = [CLAUDE]): Scripted {
  const listeners = new Set<(event: ChatEvent) => void>();
  let list = [...providers];
  let failure: string | null = null;
  let turns = 0;
  let hold = false;
  let queue = false;
  const stopped = new Set<string>();
  /** The editor's and the actions' answers: kept, failed, held or streamed the same way. */
  async function answer(id: string, keep: () => void, onText: (text: string) => void) {
    keep();
    if (failure) {
      const reason = failure;
      failure = null;
      throw new Error(reason);
    }
    const half = Math.ceil(client.answer.length / 2);
    onText(client.answer.slice(0, half));
    if (hold) {
      hold = false;
      while (!stopped.has(id)) await new Promise((done) => setTimeout(done, 5));
      return { text: client.answer.slice(0, half), stopped: true, note: null };
    }
    onText(client.answer.slice(half));
    return { text: client.answer, stopped: false, note: null };
  }
  const client: Scripted = {
    kind: "app",
    requests: [],
    brainstorms: [],
    saved: [],
    drafts: [],
    models: ["model-large", "model-small"],
    capabilities: null,
    capabilityAsks: [],
    writes: [],
    runs: [],
    catalog: BUILT_IN_CATALOG,
    answer: "A clearer sentence.",
    holdNext: () => void (hold = true),
    stops: [],
    resets: [],
    rewinds: [],
    view: { id: "set-1", files: [], pictures: [], steps: [] },
    applyResult: { status: "applied", commit: "abc123", paths: [] },
    recalculated: { dropped: [] },
    applied: [],
    recalcs: [],
    discarded: [],
    attached: [],
    dropped: [],
    threadList: [],
    loads: {},
    uis: [],
    snapshots: {},
    stateAsks: [],
    continues: [],
    deleted: [],
    loadErrors: {},
    newThreads: [],
    unarchives: [],
    archives: [],
    archivedDeletes: [],
    skipOnDelete: [],
    limitValues: { ...DEFAULT_CHAT_LIMITS },
    ties: {},
    unbinds: [],
    rebinds: [],
    imports: [],
    imported: { bound: 0, missing: 0, kept: 0 },
    queueNext: () => void (queue = true),
    budgetValues: { ...DEFAULT_BUDGETS },
    outcomes: [],
    clearedOutcomes: 0,
    emit: (event) => listeners.forEach((listener) => listener(event)),
    failNext: (message) => void (failure = message),
    providers: async () => list,
    async saveProvider(provider, key) {
      client.saved.push({ provider, key });
      const known = list.find((p) => p.name === provider.name);
      const next = { ...provider, hasKey: key === null ? Boolean(known?.hasKey) : key !== "", confirmed: true };
      list = known ? list.map((p) => (p === known ? next : p)) : [...list, next];
      return list;
    },
    async removeProvider(name) {
      list = list.filter((p) => p.name !== name);
      return list;
    },
    async confirmProvider(name) {
      list = list.map((p) => (p.name === name ? { ...p, confirmed: true } : p));
      return list;
    },
    async testProvider(name, model) {
      const provider = list.find((p) => p.name === name);
      if (failure) {
        const reason = failure;
        failure = null;
        return { ok: false, model: model || provider?.model || "", millis: 12, reply: "", message: reason };
      }
      return { ok: true, model: model || provider?.model || "", millis: 1234, reply: "OK", message: `${name} answered in 1.2 s` };
    },
    async listProviderModels(provider, key) {
      client.drafts.push({ provider, key });
      if (failure) {
        const reason = failure;
        failure = null;
        throw new Error(reason);
      }
      return client.models;
    },
    async modelCapabilities(provider, model) {
      client.capabilityAsks.push(`${provider}|${model}`);
      if (!client.capabilities) throw new Error("No capabilities in this test");
      return { ...client.capabilities, model };
    },
    async testProviderDraft(provider, key) {
      client.drafts.push({ provider, key });
      return client.testProvider(provider.name, provider.model);
    },
    async send(request): Promise<ChatTurn> {
      if (failure) {
        const reason = failure;
        failure = null;
        throw new Error(reason);
      }
      client.requests.push(request);
      if (queue) {
        queue = false;
        return { chat: request.chat, session: `session-${request.chat}`, turn: `turn-${turns}`, queued: true };
      }
      return { chat: request.chat, session: `session-${request.chat}`, turn: `turn-${++turns}` };
    },
    async attach(name, kind, bytes) {
      if (failure) {
        const reason = failure;
        failure = null;
        throw new Error(reason);
      }
      client.attached.push({ name, kind, bytes });
      const text = kind === "text" ? new TextDecoder().decode(bytes) : null;
      return { id: `att-${client.attached.length}`, kind, name, mime: kind === "text" ? "text/plain" : "image/png", bytes: bytes.length, ...(text !== null ? { chars: Array.from(text).length } : {}) };
    },
    async attachment(id) {
      const at = Number(id.replace("att-", "")) - 1;
      return client.attached[at]?.bytes ?? new Uint8Array();
    },
    async dropAttachment(id) {
      client.dropped.push(id);
    },
    async continueTurn(chat) {
      if (failure) {
        const reason = failure;
        failure = null;
        throw new Error(reason);
      }
      client.continues.push(chat);
      return { chat, session: `session-${chat}`, turn: `turn-${++turns}`, queued: false };
    },
    threads: async () => client.threadList,
    async load(chat) {
      if (chat in client.loadErrors) throw client.loadErrors[chat];
      const found = client.loads[chat];
      if (!found) throw new Error(`No saved chat ${chat}`);
      return found;
    },
    async saveUi(chat, ui) {
      client.uis.push({ chat, ui });
    },
    async state(chat, sinceSeq) {
      client.stateAsks.push([chat, sinceSeq]);
      return client.snapshots[chat] ?? { status: "idle", seq: sinceSeq, events: [], gap: false };
    },
    async deleteThread(chat) {
      client.deleted.push(chat);
    },
    budgets: async () => client.budgetValues,
    async setBudgets(budgets) {
      client.budgetValues = budgets;
    },
    diagnostics: async () => client.outcomes,
    async clearDiagnostics() {
      client.outcomes = [];
      client.clearedOutcomes++;
    },
    write: (request, onText) => answer(request.id, () => client.writes.push(request), onText),
    runAction: (run, onText) => answer(run.id, () => client.runs.push(run), onText),
    aiActions: async () => client.catalog,
    async stopWrite(id) {
      stopped.add(id);
    },
    async stop(chat) {
      client.stops.push(chat);
    },
    async reset(chat) {
      client.resets.push(chat);
    },
    async newThread(from) {
      client.newThreads.push(from);
      const id = `chat-new-${client.newThreads.length}`;
      // A tie on `from` moves to the new thread.
      const tie = from ? client.ties[from] : undefined;
      if (from && tie) {
        delete client.ties[from];
        client.ties[id] = tie;
      }
      return { id, ...(tie ? { bound: tie } : {}) };
    },
    async archive(id) {
      client.archives.push(id);
      client.threadList = client.threadList.map((t) => (t.id === id ? { ...t, archived: true, bound: null } : t));
      return true;
    },
    async unarchive(id) {
      client.unarchives.push(id);
      client.threadList = client.threadList.map((t) => (t.id === id ? { ...t, archived: false } : t));
      return true;
    },
    async deleteArchived(ids) {
      client.archivedDeletes.push(ids);
      const skipped = client.skipOnDelete;
      const deleted = ids.filter((id) => !skipped.some((s) => s.id === id));
      client.threadList = client.threadList.filter((t) => !deleted.includes(t.id));
      return { deleted, count: deleted.length, skipped };
    },
    limits: async () => client.limitValues,
    async setLimits(limits) {
      client.limitValues = limits;
      return limits;
    },
    async bind(thread, target) {
      const lost = Object.entries(client.ties).filter(([id, tie]) => id !== thread && tie.kind === target.kind && tie.path === target.path).map(([id]) => id);
      for (const id of lost) delete client.ties[id];
      client.ties[thread] = target;
      return lost;
    },
    async unbind(thread) {
      client.unbinds.push(thread);
      const had = thread in client.ties;
      delete client.ties[thread];
      return had;
    },
    async threadFor(target) {
      const id = Object.keys(client.ties).find((key) => client.ties[key]!.kind === target.kind && client.ties[key]!.path === target.path);
      return (id && client.threadList.find((t) => t.id === id)) || null;
    },
    async rebind(moves) {
      client.rebinds.push(moves);
      return moves.length;
    },
    async importBindings(map) {
      client.imports.push(map);
      return client.imported;
    },
    async rewind(chat, keep) {
      client.rewinds.push([chat, keep]);
      return keep;
    },
    async changes() {
      return client.view;
    },
    async applyChanges(chat) {
      client.applied.push(chat);
      return client.applyResult;
    },
    async recalcChanges(chat) {
      client.recalcs.push(chat);
      return client.recalculated;
    },
    async discardChanges(chat) {
      client.discarded.push(chat);
    },
    async save(): Promise<NoteFile> {
      throw new Error("Not in this test");
    },
    async brainstorm(request) {
      if (failure) {
        const reason = failure;
        failure = null;
        throw new Error(reason);
      }
      client.brainstorms.push(request);
      const cards = Array.from({ length: request.count }, (_, i) => `inbox/idea-${i + 1}.md`);
      return { session: `brainstorm-${client.brainstorms.length}`, cards, section: "section-1" };
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return client;
}

/** An empty chat store on `client`. */
export function resetChat(client: ChatClient): void {
  forgetCapabilities();
  useChat.setState({ threads: {}, order: [], active: null, saved: {}, savedLoaded: false });
  useChat.getState().connect(client);
}
