// The chat in the promo demo. It is the preview's stand-in (preview/fake-chat)
// with one difference: asked to plan next week, it streams a fixed answer and
// PROPOSES a page of three to-dos, held as staged changes until the person
// applies them (or written at once with "Apply directly"). Applying goes
// through the vault's agent ops, in the thread's session, so "Undo this chat's
// changes" and History undo it in one step. Any other message gets a short
// canned answer; messages about a slide or a diagram stay with the stand-in.

import { pause } from "../../../demo/clock";
import { isoDay } from "../../../lib/dates";
import type { NewNote, NoteFile, VaultClient } from "../../../lib/vault/types";
import type { ChatClient } from "../client";
import { pieces } from "../preview/canned";
import { previewChat } from "../preview/fake-chat";
import type { ApplyResult, ChangesView, ChatEvent, ChatProvider, ChatRequest, FileChange } from "../types";
import { fileText, isPlanRequest, otherAnswer, planIntro, planStaged, planWritten, weekPlan, type WeekPlan } from "./plan";

type Agent = { session: string; client: string };

interface PreviewVault extends VaultClient {
  agentCreate?(agent: Agent, note: NewNote, body: string): Promise<NoteFile>;
}

/** The provider the demo starts with: a ChatGPT plan, so the chat works at once. */
export const DEMO_PROVIDER: ChatProvider = { name: "ChatGPT", kind: "chatgpt", baseUrl: "", model: "gpt-6.1-sol", hasKey: false, confirmed: true };

/** The models the pretend ChatGPT account offers. */
export const DEMO_MODELS = ["gpt-6.1-sol", "gpt-6.1-mini"];

export interface DemoChatOptions {
  /** Milliseconds between the answer's pieces; 0 in tests. */
  pace?: number;
}

/** What a thread has staged. */
interface Staged {
  id: string;
  plan: WeekPlan;
  path: string;
  day: string;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(++counter).toString(36)}`;

/** Up to three titles of the vault's own notes, the same ones every time. */
async function notesToPlanFrom(client: VaultClient | null): Promise<string[]> {
  if (!client) return [];
  const all = await client.list().catch(() => []);
  return all
    .filter((n) => (n.kind === "page" || n.kind === "card") && !n.path.startsWith("chats/") && !/^welcome/i.test(n.title) && n.title !== "Week plan")
    .map((n) => n.title)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 3);
}

export function demoChat(vault: () => VaultClient | null, options: DemoChatOptions = {}): ChatClient {
  const pace = options.pace ?? 14;
  const base = previewChat(vault, { pace, providers: [DEMO_PROVIDER] });
  const listeners = new Set<(event: ChatEvent) => void>();
  const emit = (event: ChatEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  base.onEvent(emit);
  const sessions = new Map<string, string>();
  const staged = new Map<string, Staged>();
  const running = new Map<string, { stop: boolean }>();

  const sessionOf = (chat: string): string => {
    let session = sessions.get(chat);
    if (!session) sessions.set(chat, (session = nextId("demo-session")));
    return session;
  };

  /** Writes the plan as the chat's own work: one agent session, so one undo takes it back. */
  async function write(chat: string, plan: WeekPlan, day: string): Promise<string[]> {
    const client = vault() as PreviewVault | null;
    if (!client) throw new Error("No vault is open");
    const note: NewNote = { kind: "page", title: plan.title, date: day };
    if (client.agentCreate) return [(await client.agentCreate({ session: sessionOf(chat), client: "chat" }, note, plan.body)).meta.path];
    const created = await client.create(note);
    return [(await client.saveBody(created.meta.path, plan.body, created.hash)).note.meta.path];
  }

  async function play(request: ChatRequest, turn: string): Promise<void> {
    const run = { stop: false };
    running.set(request.chat, run);
    const say = (event: Omit<ChatEvent, "chat" | "turn">) => emit({ chat: request.chat, turn, ...event });
    const stream = async (text: string): Promise<boolean> => {
      for (const piece of pieces(text)) {
        if (run.stop) return false;
        say({ kind: "text", text: piece });
        await pause(pace);
      }
      return !run.stop;
    };
    const ended = () => say({ kind: "done", stopped: true });
    try {
      await pause(pace);
      if (!isPlanRequest(request.text)) {
        if (!(await stream(otherAnswer(request)))) return ended();
        return say({ kind: "done" });
      }
      const notes = await notesToPlanFrom(vault());
      const plan = weekPlan(notes);
      const day = isoDay(new Date());
      if (!(await stream(planIntro(notes)))) return ended();
      const id = nextId("tool");
      say({ kind: "tool", tool: { id, name: "create_note", input: { type: "page", title: plan.title } } });
      await pause(pace * 30);
      if (run.stop) return ended();
      // As the chat's switch reads it: Review everything always holds changes back, Autonomous never does.
      const mode = await vault()?.agentPolicy().then((view) => view.active, () => null);
      const direct = mode === "autonomous" ? true : mode === "review" ? false : request.writes === "direct";
      if (direct) {
        const paths = await write(request.chat, plan, day);
        say({ kind: "toolResult", result: { id, ok: true, summary: `Created page “${plan.title}”`, paths } });
        if (!(await stream(planWritten(plan.title, plan.tasks.length)))) return ended();
        return say({ kind: "done" });
      }
      const held: Staged = { id: nextId("changes"), plan, path: `library/${plan.title.toLowerCase().replace(/\s+/g, "-")}.md`, day };
      staged.set(request.chat, held);
      say({ kind: "toolResult", result: { id, ok: true, summary: `Created page “${plan.title}”`, paths: [held.path], staged: true } });
      say({ kind: "changes", changes: { id: held.id, count: 1, paths: [held.path] } });
      if (!(await stream(planStaged(plan.tasks.length)))) return ended();
      say({ kind: "done" });
    } catch (err) {
      say({ kind: "error", error: message(err) });
    } finally {
      if (running.get(request.chat) === run) running.delete(request.chat);
    }
  }

  const fileOf = (held: Staged): FileChange => ({ path: held.path, kind: "note", title: held.plan.title, new: true, before: null, after: fileText(held.plan, held.day), diff: "", stale: false });

  return {
    ...base,
    kind: "preview",
    // The pretend ChatGPT account lists its own models.
    listProviderModels: async (provider, key) => (provider.kind === "chatgpt" ? [...DEMO_MODELS] : base.listProviderModels(provider, key)),
    async send(request) {
      // A message about a slide or a diagram keeps the stand-in's scripted edit.
      if (request.context.some((chip) => chip.kind === "slide" || chip.kind === "deck" || chip.kind === "diagram")) return base.send(request);
      const going = running.get(request.chat);
      if (going) return { chat: request.chat, session: sessionOf(request.chat), turn: nextId("turn"), queued: true };
      const turn = nextId("turn");
      void play(request, turn);
      return { chat: request.chat, session: sessionOf(request.chat), turn };
    },
    async stop(chat) {
      const run = running.get(chat);
      if (run) run.stop = true;
      await base.stop(chat);
    },
    async reset(chat) {
      const run = running.get(chat);
      if (run) run.stop = true;
      sessions.delete(chat);
      await base.reset(chat);
    },
    async changes(chat): Promise<ChangesView> {
      const held = staged.get(chat);
      if (!held) return { id: "", files: [], pictures: [], steps: [] };
      return { id: held.id, files: [fileOf(held)], pictures: [], steps: [{ summary: `Created page “${held.plan.title}” with ${held.plan.tasks.length} to-dos`, paths: [held.path] }] };
    },
    async applyChanges(chat): Promise<ApplyResult> {
      const held = staged.get(chat);
      if (!held) return { status: "applied", commit: null, paths: [] };
      const paths = await write(chat, held.plan, held.day);
      staged.delete(chat);
      return { status: "applied", commit: null, paths };
    },
    async recalcChanges() {
      return { dropped: [] };
    },
    async discardChanges(chat) {
      staged.delete(chat);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
