// The chat in the browser preview, where there is no AI provider: a stand-in
// for the app's backend that streams a canned answer a few letters at a
// time. A message that mentions a card shows a tool call for real: the card
// is made in the preview vault, in the thread's session, so its row links to
// it and "Undo this chat's changes" takes it back. A brainstorm places
// canned ideas the same way, in a session of its own. A message that has a slide
// as context gets a scripted change to that slide (deck-reply.ts).

import { isoDay } from "../../../lib/dates";
import type { NewNote, NoteFile, VaultClient } from "../../../lib/vault/types";
import type { ChatClient } from "../client";
import { MAX_IDEAS, type Brainstormed, type ChatEvent, type ChatProvider, type ChatRequest, type Idea, type ToolResult } from "../types";
import { BUILT_IN_ACTIONS, BUILT_IN_CATALOG } from "./actions";
import { afterCard, cardBody, pieces, replyFor } from "./canned";
import { type DeckVault, playDeck, slideAsk } from "./deck-reply";
import { diagramAsk, playDiagram } from "./diagram-reply";
import { previewAgent } from "./fake-agent";
import { cannedIdeas, sectionLabel } from "./ideas";
import { cannedAction, cannedWriting } from "./writing";

type Agent = { session: string; client: string };

/** What the preview's vault adds for this stand-in (memory-agents.ts). */
interface PreviewVault extends VaultClient {
  agentCreate?(agent: Agent, note: NewNote, body: string): Promise<NoteFile>;
  saveChat?(title: string, markdown: string): Promise<NoteFile>;
  brainstorm?(agent: Agent, board: string, label: string, ideas: readonly Idea[], date: string): Promise<Brainstormed>;
}

/** The provider the preview starts with. */
export const PREVIEW_PROVIDER: ChatProvider = { name: "Preview", kind: "openai", baseUrl: "http://localhost/preview/v1", model: "canned-replies", hasKey: false, confirmed: true };

/** The client name the preview's chat sessions carry in history. */
export const CHAT_CLIENT = "chat";
/** And its brainstorms, as the app's do. */
export const BRAINSTORM_CLIENT = "kasten-brainstorm";

export interface PreviewOptions {
  /** Milliseconds between the answer's pieces; 0 in tests. */
  pace?: number;
  providers?: ChatProvider[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}`;

/** A new note with a body, through the plain vault ops. */
async function createWithBody(client: VaultClient, note: NewNote, body: string): Promise<NoteFile> {
  const made = await client.create(note);
  return (await client.saveBody(made.meta.path, body, made.hash)).note;
}

export function previewChat(vault: () => VaultClient | null, options: PreviewOptions = {}): ChatClient {
  const pace = options.pace ?? 14;
  let providers: ChatProvider[] = [...(options.providers ?? [PREVIEW_PROVIDER])];
  const listeners = new Set<(event: ChatEvent) => void>();
  const sessions = new Map<string, string>();
  /** Editor writes under way, and whether each was stopped. */
  const writing = new Map<string, boolean>();
  /** Turns under way by thread; Stop sets `stop`. */
  const running = new Map<string, { turn: string; stop: boolean; queue: string[] }>();
  const emit = (event: ChatEvent) => {
    for (const listener of [...listeners]) listener(event);
  };

  async function makeCard(id: string, title: string, session: string, asked: string): Promise<{ result: ToolResult; made: NoteFile | null }> {
    const client = vault() as PreviewVault | null;
    const note: NewNote = { kind: "card", title, date: isoDay(new Date()) };
    try {
      if (!client) throw new Error("no vault is open");
      const made = client.agentCreate ? await client.agentCreate({ session, client: CHAT_CLIENT }, note, cardBody(asked)) : await createWithBody(client, note, cardBody(asked));
      return { result: { id, ok: true, summary: `Created card “${made.meta.title}”`, paths: [made.meta.path] }, made };
    } catch (err) {
      return { result: { id, ok: false, summary: `Could not create card “${title}”: ${message(err)}`, paths: [] }, made: null };
    }
  }

  /** Types `answer` out as a write, a piece at a time, until it ends or is stopped. */
  async function typed(id: string, answer: string, onText: (text: string) => void) {
    writing.set(id, false);
    let said = "";
    try {
      for (const piece of pieces(answer)) {
        await wait(pace);
        if (writing.get(id)) return { text: said, stopped: true, note: null };
        said += piece;
        onText(piece);
      }
      return { text: said, stopped: false, note: null };
    } finally {
      writing.delete(id);
    }
  }

  async function play(request: ChatRequest, turn: string, session: string): Promise<void> {
    const run = { turn, stop: false, queue: [] as string[] };
    running.set(request.chat, run);
    const say = (event: Omit<ChatEvent, "chat" | "turn">) => emit({ chat: request.chat, turn, ...event });
    const stream = async (text: string) => {
      for (const piece of pieces(text)) {
        if (run.stop) return false;
        say({ kind: "text", text: piece });
        // A message sent meanwhile is taken up at the next step: here, the next piece.
        for (const waiting of run.queue.splice(0)) say({ kind: "queued", text: waiting, delivered: true });
        await wait(pace);
      }
      return !run.stop;
    };
    try {
      await wait(pace);
      const ask = slideAsk(request.context);
      if (ask) {
        const played = await playDeck({ vault: vault() as DeckVault | null, ask, text: request.text, agent: { session, client: CHAT_CLIENT }, say, stream, pause: () => wait(pace * 30), id: () => nextId("tool") });
        return say(played ? { kind: "done" } : { kind: "done", stopped: true });
      }
      const drawing = diagramAsk(request);
      if (drawing) {
        const played = await playDiagram({ vault: vault(), request, say, stream, pause: () => wait(pace * 30), id: () => nextId("tool") }, drawing);
        return say(played ? { kind: "done" } : { kind: "done", stopped: true });
      }
      for (const step of replyFor(request)) {
        if (typeof step === "string") {
          if (!(await stream(step))) return say({ kind: "done", stopped: true });
          continue;
        }
        const id = nextId("tool");
        say({ kind: "tool", tool: { id, name: "create_note", input: { type: "card", title: step.card } } });
        await wait(pace * 30);
        const { result, made } = await makeCard(id, step.card, session, request.text);
        say({ kind: "toolResult", result });
        if (!(await stream(afterCard(made ? made.meta.title : null, result.summary)))) return say({ kind: "done", stopped: true });
      }
      say({ kind: "done" });
    } catch (err) {
      say({ kind: "error", error: message(err) });
    } finally {
      if (running.get(request.chat) === run) running.delete(request.chat);
    }
  }

  return {
    kind: "preview",
    ...previewAgent(),
    providers: async () => providers.map((p) => ({ ...p })),
    async saveProvider(draft, key) {
      const known = providers.find((p) => p.name === draft.name);
      // Keys are never kept here: the preview only notes whether one was given.
      const hasKey = key === null ? Boolean(known?.hasKey) : key !== "";
      const next = { ...draft, hasKey, confirmed: true };
      providers = known ? providers.map((p) => (p === known ? next : p)) : [...providers, next];
      return providers.map((p) => ({ ...p }));
    },
    async removeProvider(name) {
      providers = providers.filter((p) => p.name !== name);
      return providers.map((p) => ({ ...p }));
    },
    async confirmProvider(name) {
      providers = providers.map((p) => (p.name === name ? { ...p, confirmed: true } : p));
      return providers.map((p) => ({ ...p }));
    },
    async testProvider(name, model) {
      const provider = providers.find((p) => p.name === name);
      if (!provider) throw new Error(`No AI provider called “${name}”`);
      const asked = model || provider.model;
      return { ok: true, model: asked, millis: 42, reply: "OK", message: `${name} answered in 0.0 s (the browser preview answers without a network)` };
    },
    // No provider is reached from the preview: every address "offers" the
    // canned model and answers at once.
    listProviderModels: async () => [PREVIEW_PROVIDER.model],
    // As a local OpenAI-compatible server: a temperature and a longest answer.
    modelCapabilities: async (_provider, model) => ({
      version: 1,
      route: { kind: "chatCompletions", official: false },
      model,
      family: "preview",
      verified: true,
      reasoningEffort: null,
      thinking: null,
      temperature: { min: 0, max: 2 },
      maxOutput: { min: 256, max: 32000 },
      effortRefused: false,
    }),
    async testProviderDraft(draft) {
      return { ok: true, model: draft.model, millis: 42, reply: "OK", message: `${draft.name || "The provider"} answered in 0.0 s (the browser preview answers without a network)` };
    },
    async write(request, onText) {
      if (!providers.some((p) => p.name === request.provider)) throw new Error(`No AI provider called “${request.provider}”`);
      return typed(request.id, cannedWriting(request), onText);
    },
    aiActions: async () => BUILT_IN_CATALOG,
    async runAction(run, onText) {
      if (!providers.some((p) => p.name === run.provider)) throw new Error(`No AI provider called “${run.provider}”`);
      const action = BUILT_IN_ACTIONS.find((a) => a.slug === run.action);
      if (!action) throw new Error(`There is no AI action called “${run.action}”`);
      const missing = action.needs.find((need) => (need === "selection" ? !run.selection?.trim() : need === "page" ? !run.page?.trim() : false));
      if (missing) throw new Error(`“${action.title}” needs ${missing === "selection" ? "some selected text" : "the text of a page"}`);
      return typed(run.id, cannedAction(run), onText);
    },
    async stopWrite(id) {
      if (writing.has(id)) writing.set(id, true);
    },
    async send(request) {
      if (!providers.some((p) => p.name === request.provider)) throw new Error(`No AI provider called “${request.provider}”`);
      const going = running.get(request.chat);
      if (going) {
        // As the app does: it waits for the next step, and the person sees it waiting.
        going.queue.push(request.text);
        emit({ chat: request.chat, turn: going.turn, kind: "queued", text: request.text, delivered: false });
        return { chat: request.chat, session: sessions.get(request.chat) ?? "", turn: going.turn, queued: true };
      }
      const session = sessions.get(request.chat) ?? nextId("chat-session");
      sessions.set(request.chat, session);
      const turn = nextId("turn");
      void play(request, turn, session);
      return { chat: request.chat, session, turn };
    },
    async stop(chat) {
      const run = running.get(chat);
      if (run) run.stop = true;
    },
    async reset(chat) {
      const run = running.get(chat);
      if (run) run.stop = true;
      sessions.delete(chat);
    },
    // The preview keeps no conversation of its own to take back.
    rewind: async (_chat, keep) => keep,
    // The preview writes at once, as a chat the person lets write directly does:
    // it has nothing staged to look at, apply or throw away.
    changes: async () => ({ id: "", files: [], pictures: [], steps: [] }),
    applyChanges: async () => ({ status: "applied", commit: null, paths: [] }),
    recalcChanges: async () => ({ dropped: [] }),
    discardChanges: async () => {},
    async save(title, markdown) {
      const client = vault() as PreviewVault | null;
      if (!client) throw new Error("No vault is open");
      return client.saveChat ? client.saveChat(title, markdown) : createWithBody(client, { kind: "page", title, date: isoDay(new Date()) }, markdown);
    },
    async brainstorm(request) {
      if (!providers.some((p) => p.name === request.provider)) throw new Error(`No AI provider called “${request.provider}”`);
      const client = vault() as PreviewVault | null;
      if (!client?.brainstorm) throw new Error("No vault is open");
      const board = await client.board(request.board);
      const ideas = cannedIdeas(request.topic, board, Math.min(Math.max(1, Math.round(request.count)), MAX_IDEAS));
      if (ideas.length === 0) throw new Error("The preview has no more canned ideas for this board");
      // As long as a model might take to answer, give or take.
      await wait(pace * 60);
      return client.brainstorm({ session: nextId("brainstorm-session"), client: BRAINSTORM_CLIENT }, board.path, sectionLabel(request.topic), ideas, isoDay(new Date()));
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
