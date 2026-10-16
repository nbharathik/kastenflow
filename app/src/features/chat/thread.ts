// A chat thread as the window keeps it: the messages, each answer's text and
// tool rows in the order they streamed, and the agent session the thread
// runs in. Pure functions from one thread to the next, so the store stays
// small and the rules are easy to test.

import type { AttachKind, Paused, PlanItem } from "./agent-types";
import { pausedOf, planOf, queuedOf, retryOf, roundOf } from "./thread-events";
import type { ChangesInfo, ChatEvent, ChatTurn, ContextChip, FailKind, GenerationSettings, ToolCall, ToolResult } from "./types";

/** Why a chip is on a thread: "auto" follows the page being looked at and is
 * swapped when that changes; "pinned" was an auto chip kept; "added" was
 * chosen by the person. Only the window knows; `bare` leaves it out. */
export type ChipOrigin = "auto" | "pinned" | "added";

/** A context chip on a thread. Threads saved before chips were counted no
 * more may still carry a `chars` estimate; `bare` leaves it out. */
export interface Chip extends ContextChip {
  origin?: ChipOrigin;
}

/** A chip without an origin was added by the person. */
export const originOf = (chip: Chip): ChipOrigin => chip.origin ?? "added";

/** A piece of an answer: its text, a tool call, or a message the person sent while it worked and it took up at its next step. */
export type Part = { kind: "text"; text: string } | { kind: "tool"; call: ToolCall; result: ToolResult | null } | { kind: "steer"; text: string };

/** A file or picture that went with a message. */
export interface SentAttachment {
  id: string;
  name: string;
  kind: AttachKind;
  /** What its chip said. */
  label: string;
  /** A picture drawn small (a blob: address, for this session only). */
  thumb?: string;
}

export interface UserMessage {
  id: string;
  role: "user";
  text: string;
  /** What the thread was grounded in when it was sent. */
  context: ContextChip[];
  /** What went with it. */
  attachments?: SentAttachment[];
}

/** `paused`: it stopped short for a reason that is not a failure, and can go on. */
export type AnswerStatus = "streaming" | "done" | "stopped" | "error" | "paused";

export interface Answer {
  id: string;
  role: "assistant";
  /** The turn it answers; null until `chat_send` or its first event names it. */
  turn: string | null;
  provider: string;
  model: string;
  parts: Part[];
  status: AnswerStatus;
  error: string | null;
  /** What kind of failure the error is, so the message can offer a way on. */
  errorKind?: FailKind;
  /** Something the person should know about how it was asked, such as a
   * setting the model did not take. */
  notice?: string;
  /** "Connection dropped, trying again (2 of 4)": there while it tries, gone once the answer goes on. */
  retry?: string;
  /** The card it was pinned as. */
  pinned: string | null;
}

export type Message = UserMessage | Answer;

export interface Thread {
  id: string;
  created: number;
  /** Chosen for this thread; null takes the last one used. */
  provider: string | null;
  model: string | null;
  context: Chip[];
  messages: Message[];
  /** Its agent session, once the first turn has started. */
  session: string | null;
  streaming: boolean;
  /** Stop was pressed; the turn's done has not come yet. */
  stopping: boolean;
  /** A tool of its session wrote to the vault. */
  changed: boolean;
  /** Its session's changes were undone. */
  undone: boolean;
  /** What it has staged for the person to review and has not applied yet;
   * absent when nothing waits. */
  changes?: ChangesInfo;
  /** Its writes are made at once ("Apply directly") instead of waiting as
   * staged changes. Off unless set. */
  direct?: boolean;
  /** What it answers with, set in the Advanced popover; unset takes what was
   * last used with its model (prefs.ts). */
  settings?: GenerationSettings;
  /** Whether its page chip follows the page being looked at; on unless false. */
  follow?: boolean;
  /** Pictures go to its model although it is not known to read them (a local server's). */
  allowImages?: boolean;
  /** The name the person gave it, instead of its first question. */
  title?: string;
  /** Why its turn stopped short and can go on; absent otherwise. */
  pause?: Paused;
  /** The assistant's plan for a long task, as it last updated it. */
  plan?: PlanItem[];
  /** Messages sent while it worked, waiting for its next step. */
  queued?: string[];
  /** The step the model is on while it works. */
  round?: number;
  /** The last event of the backend's count taken in, so an event seen twice counts once. */
  seq?: number;
}

export type ThreadStatus = "working" | "paused" | "interrupted" | "done" | "failed" | "idle";

/** Where a thread is, for its list and the dots: working, stopped short, finished well or not. */
export function threadStatus(thread: Thread): ThreadStatus {
  if (thread.streaming) return "working";
  if (thread.pause) return thread.pause.reason === "interrupted" ? "interrupted" : "paused";
  const last = thread.messages[thread.messages.length - 1];
  if (last?.role !== "assistant") return "idle";
  return last.status === "error" ? "failed" : last.status === "done" ? "done" : "idle";
}

/** Whether the thread's page chip follows the page in front. */
export const following = (thread: Thread): boolean => thread.follow !== false;

let seq = 0;

/** An id this window has not used: time, a counter and some randomness. */
export function newId(prefix: string): string {
  const random = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(36).padStart(2, "0")).join("");
  return `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}${random}`;
}

export function newThread(options: { context?: Chip[]; provider?: string | null; model?: string | null; follow?: boolean } = {}): Thread {
  return {
    id: newId("chat"),
    created: Date.now(),
    provider: options.provider ?? null,
    model: options.model ?? null,
    context: options.context ?? [],
    messages: [],
    session: null,
    streaming: false,
    stopping: false,
    changed: false,
    undone: false,
    ...(options.follow === false ? { follow: false } : {}),
  };
}

/** The name the person gave the thread, else the first thing asked. */
export function threadTitle(thread: Thread): string {
  if (thread.title?.trim()) return thread.title.trim();
  const first = thread.messages.find((m): m is UserMessage => m.role === "user");
  const text = first?.text.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "New chat";
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
}

/** Whether the thread's name, or anything said in it, holds `query` (any case). */
export function matchesThread(thread: Thread, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  if (threadTitle(thread).toLowerCase().includes(wanted)) return true;
  return thread.messages.some((m) => (m.role === "user" ? m.text : answerText(m)).toLowerCase().includes(wanted));
}

/** A chip's identity: two chips naming the same thing are one. */
export const chipKey = (chip: ContextChip) => `${chip.kind}:${chip.ref.join("\u0000")}`;

/** A chip as the request sends it. */
export const bare = ({ kind, label, ref }: ContextChip): ContextChip => ({ kind, label, ref: [...ref] });

/** `context` with the followed page swapped: the "auto" chips go, and `next`
 * comes in as the one auto chip, unless the person already has that very
 * thing there (pinned or added), which then stays as it is. */
export function followChips(context: readonly Chip[], next: Chip | null): Chip[] {
  const autos = context.filter((chip) => originOf(chip) === "auto");
  const kept = context.filter((chip) => originOf(chip) !== "auto");
  const wanted = next && !kept.some((chip) => chipKey(chip) === chipKey(next)) ? next : null;
  // The same chip is there already: nothing changes, not even the array.
  if (autos.length === (wanted ? 1 : 0) && (!wanted || chipKey(autos[0]!) === chipKey(wanted))) return context as Chip[];
  return wanted ? [{ ...wanted, origin: "auto" }, ...kept] : kept;
}

/** How many of the questions in `messages` (before `upTo`) the backend still
 * has in its conversation: those whose answer said something or finished. A
 * turn that failed or was stopped before saying anything leaves no trace
 * there. */
export function rememberedQuestions(messages: readonly Message[], upTo = messages.length): number {
  let count = 0;
  for (let i = 0; i < Math.min(upTo, messages.length); i++) {
    const asked = messages[i];
    const answer = messages[i + 1];
    if (asked?.role !== "user") continue;
    if (answer?.role === "assistant" && (answer.parts.length > 0 || answer.status === "done")) count++;
  }
  return count;
}

/** A message sent: the question, and an answer waiting for its turn. */
export function startTurn(thread: Thread, text: string, provider: string, model: string, attachments: SentAttachment[] = []): Thread {
  const question: UserMessage = { id: newId("m"), role: "user", text, context: thread.context.map(bare), ...(attachments.length ? { attachments } : {}) };
  const answer: Answer = { id: newId("m"), role: "assistant", turn: null, provider, model, parts: [], status: "streaming", error: null, pinned: null };
  return { ...thread, provider, model, messages: [...thread.messages, question, answer], streaming: true, stopping: false, pause: undefined, round: undefined };
}

/** Carries on a paused answer in place: it streams again, under the turn the backend names next. */
export function continued(thread: Thread): Thread {
  const at = thread.messages.length - 1;
  const answer = thread.messages[at];
  if (!thread.pause || answer?.role !== "assistant" || answer.status !== "paused") return thread;
  return withAnswer(thread, at, { ...answer, status: "streaming", turn: null, error: null }, { streaming: true, stopping: false, pause: undefined });
}

/** A message sent while the model works: it waits for the next step, shown as pending. */
export const queueMessage = (thread: Thread, text: string): Thread => (thread.queued?.includes(text) ? thread : { ...thread, queued: [...(thread.queued ?? []), text] });

/** Where the answer to `turn` is: its own, else the one still waiting for a turn. */
function answerAt(thread: Thread, turn: string): number {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i]!;
    if (m.role === "assistant" && m.turn === turn) return i;
  }
  const last = thread.messages.length - 1;
  const waiting = thread.messages[last];
  return waiting?.role === "assistant" && waiting.turn === null && waiting.status === "streaming" ? last : -1;
}

function withAnswer(thread: Thread, at: number, answer: Answer, rest: Partial<Thread> = {}): Thread {
  const messages = thread.messages.slice();
  messages[at] = answer;
  return { ...thread, ...rest, messages };
}

/** `chat_send` answered: the waiting answer takes its turn, the thread its session. */
export function turnStarted(thread: Thread, started: ChatTurn): Thread {
  const at = answerAt(thread, started.turn);
  const session = thread.session === started.session ? {} : { session: started.session };
  if (at < 0) return { ...thread, ...session };
  const answer = thread.messages[at] as Answer;
  return answer.turn === started.turn ? { ...thread, ...session } : withAnswer(thread, at, { ...answer, turn: started.turn }, session);
}

/** Ends the answer under way from this side: `chat_send` failed, or a
 * stopped turn's done never came. */
export function endTurn(thread: Thread, status: "stopped" | "error", error: string | null = null): Thread {
  const at = thread.messages.length - 1;
  const answer = thread.messages[at];
  // Stopped, what waited for a next step will not be read.
  const done = { streaming: false, stopping: false, round: undefined, ...(status === "stopped" ? { queued: undefined } : {}) };
  if (answer?.role !== "assistant" || answer.status !== "streaming") return { ...thread, ...done };
  return withAnswer(thread, at, { ...answer, status, error }, done);
}

/** The answer's parts with `text` added to the text streaming now. */
function appendText(parts: Part[], text: string): Part[] {
  const last = parts[parts.length - 1];
  if (last?.kind === "text") return [...parts.slice(0, -1), { kind: "text", text: last.text + text }];
  return [...parts, { kind: "text", text }];
}

function withResult(parts: Part[], result: ToolResult): Part[] {
  const at = parts.findIndex((p) => p.kind === "tool" && p.call.id === result.id);
  if (at < 0) return [...parts, { kind: "tool", call: { id: result.id, name: "", input: null }, result }];
  const next = parts.slice();
  next[at] = { ...(parts[at] as Extract<Part, { kind: "tool" }>), result };
  return next;
}

/** One streamed event taken into the thread. Events for a turn that has
 * ended, or that the thread never started, change nothing; an event with a
 * number the thread has taken in already (a window catching up may see one
 * twice) changes nothing either. */
export function applyEvent(thread: Thread, event: ChatEvent): Thread {
  if (event.seq !== undefined && thread.seq !== undefined && event.seq <= thread.seq) return thread;
  const next = applyOne(thread, event);
  return event.seq !== undefined && next.seq !== event.seq ? { ...next, seq: event.seq } : next;
}

/** The turn's answer with `retry` gone: the answer went on, so the line about trying again is over. */
const settled = (answer: Answer): Answer => (answer.retry ? { ...answer, retry: undefined } : answer);

/** The turn is over, for now: no step, nothing tried again. */
const over = { streaming: false, stopping: false, round: undefined };

function applyOne(thread: Thread, event: ChatEvent): Thread {
  const at = answerAt(thread, event.turn);
  if (at < 0) return thread;
  const found = thread.messages[at] as Answer;
  if (found.status !== "streaming") return thread;
  const answer: Answer = found.turn === event.turn ? found : { ...found, turn: event.turn };
  switch (event.kind) {
    case "text":
      return event.text ? withAnswer(thread, at, { ...settled(answer), parts: appendText(answer.parts, event.text) }) : withAnswer(thread, at, answer);
    case "tool":
      if (!event.tool) return withAnswer(thread, at, answer);
      return withAnswer(thread, at, { ...settled(answer), parts: [...answer.parts, { kind: "tool", call: event.tool, result: null }] });
    case "toolResult": {
      if (!event.result) return withAnswer(thread, at, answer);
      // A staged change is held back: nothing was written yet.
      const wrote = event.result.ok && !event.result.staged && event.result.paths.length > 0;
      return withAnswer(thread, at, { ...settled(answer), parts: withResult(answer.parts, event.result) }, wrote ? { changed: true, undone: false } : {});
    }
    case "changes":
      return withAnswer(thread, at, answer, { changes: event.changes && event.changes.count > 0 ? event.changes : undefined });
    case "done":
      // Stopped: what waited for a next step will not be read.
      return withAnswer(thread, at, { ...settled(answer), status: event.stopped ? "stopped" : "done" }, event.stopped ? { ...over, queued: undefined } : over);
    case "error":
      // What waited stays: it is taken up when the thread goes on.
      return withAnswer(thread, at, { ...settled(answer), status: "error", error: event.error?.trim() || "The answer stopped with an error.", errorKind: event.errorKind ?? "other" }, over);
    case "paused": {
      // Short of its end for a reason that is no failure: it can go on from here.
      return withAnswer(thread, at, { ...settled(answer), status: "paused", error: null }, { ...over, pause: pausedOf(event) });
    }
    case "plan": {
      // The whole plan each time; an empty one clears it.
      const items = planOf(event.plan);
      return withAnswer(thread, at, answer, items ? { plan: items.length ? items : undefined } : {});
    }
    case "queued": {
      const sent = queuedOf(event);
      if (!sent) return withAnswer(thread, at, answer);
      // Waiting: a pending bubble. Taken up: it joins the answer where the model read it.
      if (!sent.delivered) return withAnswer(thread, at, answer, { queued: queueMessage(thread, sent.text).queued });
      const waiting = (thread.queued ?? []).filter((text, i, all) => text !== sent.text || all.indexOf(text) !== i);
      return withAnswer(thread, at, { ...answer, parts: [...answer.parts, { kind: "steer", text: sent.text }] }, { queued: waiting.length ? waiting : undefined });
    }
    case "round":
      return withAnswer(thread, at, answer, { round: roundOf(event) ?? thread.round });
    case "notice": {
      const said = event.text?.trim();
      if (!said) return withAnswer(thread, at, answer);
      if (retryOf(event)) return withAnswer(thread, at, answer.retry === said ? answer : { ...answer, retry: said });
      if (answer.notice === said) return withAnswer(thread, at, answer);
      return withAnswer(thread, at, { ...answer, notice: answer.notice ? `${answer.notice} ${said}` : said });
    }
    default:
      return thread;
  }
}

/** The answer's text, its tool rows left out: the text around each tool
 * call as paragraphs of their own. */
export const answerText = (answer: Answer) =>
  answer.parts
    .flatMap((p) => (p.kind === "text" && p.text.trim() ? [p.text.trim()] : []))
    .join("\n\n");
