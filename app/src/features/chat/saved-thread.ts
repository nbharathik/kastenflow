// A thread as it is kept between runs. The window's own copy of a thread (its
// messages, chips, name, settings, plan, how far it has taken in the backend's
// events) is what `chat_save_ui` stores and `chat_load` gives back; the backend
// has the conversation itself. This is the pure part: the copy, how it is read
// back without trust, how a thread that was working or stopped short is
// brought back, and when the copy is written.

import type { LoadedThread, Paused, PlanItem, RunStatus } from "./agent-types";
import { readSettings } from "./settings";
import { newId, newThread, type Answer, type AnswerStatus, type Chip, type Message, type Part, type SentAttachment, type Thread } from "./thread";
import { pauseDetail, planOf } from "./thread-events";
import { readForks, type Branch, type Fork } from "./thread-versions";
import type { ChipKind, ContextChip, FailKind, SelectionPayload, SelectionSource } from "./types";

/** The most a blob may be: `chat_save_ui` refuses more than 5 MB. */
export const SAVE_LIMIT = 5 * 1024 * 1024 - 64 * 1024;

const VERSION = 1;

/** The window's copy of a thread, as it is stored. */
export interface SavedThread {
  v: typeof VERSION;
  id: string;
  created: number;
  provider: string | null;
  model: string | null;
  title?: string;
  follow?: boolean;
  direct?: boolean;
  auto?: boolean;
  allowImages?: boolean;
  settings?: Thread["settings"];
  context: Chip[];
  messages: Message[];
  session: string | null;
  changed: boolean;
  undone: boolean;
  changes?: Thread["changes"];
  plan?: PlanItem[];
  queued?: string[];
  pause?: Paused;
  /** Earlier versions of the conversation (thread-versions.ts). */
  forks?: Fork[];
  /** The highest event number taken in: `chat_load` gives it back, so only the events after it are replayed. */
  seq?: number;
}

const clean = (message: Message): Message => {
  if (message.role === "assistant") {
    const { retry: _retry, ...rest } = message;
    return rest;
  }
  if (!message.attachments) return message;
  // A picture's small copy is an address that lives only as long as this window.
  return { ...message, attachments: message.attachments.map(({ thumb: _thumb, ...rest }) => rest) };
};

const cleanBranch = (branch: Branch): Branch => ({ messages: branch.messages.map(clean), forks: branch.forks.map(cleanFork) });
const cleanFork = (fork: Fork): Fork => ({ ...fork, versions: fork.versions.map((v) => (v ? cleanBranch(v) : v)) });

/** What of `thread` is kept: everything but what is only of this moment (it works, it is stopping, the step it is on). */
export function savedOf(thread: Thread): SavedThread {
  return {
    v: VERSION,
    id: thread.id,
    created: thread.created,
    provider: thread.provider,
    model: thread.model,
    ...(thread.title !== undefined ? { title: thread.title } : {}),
    ...(thread.follow !== undefined ? { follow: thread.follow } : {}),
    ...(thread.direct !== undefined ? { direct: thread.direct } : {}),
    ...(thread.auto !== undefined ? { auto: thread.auto } : {}),
    ...(thread.allowImages !== undefined ? { allowImages: thread.allowImages } : {}),
    ...(thread.settings ? { settings: thread.settings } : {}),
    context: thread.context,
    messages: thread.messages.map(clean),
    session: thread.session,
    changed: thread.changed,
    undone: thread.undone,
    ...(thread.changes ? { changes: thread.changes } : {}),
    ...(thread.plan ? { plan: thread.plan } : {}),
    ...(thread.queued ? { queued: thread.queued } : {}),
    ...(thread.pause ? { pause: thread.pause } : {}),
    ...(thread.forks?.length ? { forks: thread.forks.map(cleanFork) } : {}),
    ...(thread.seq !== undefined ? { seq: thread.seq } : {}),
  };
}

const withoutInputs = (messages: Message[]): Message[] =>
  messages.map((m) => (m.role === "assistant" ? { ...m, parts: m.parts.map((p): Part => (p.kind === "tool" && p.call.input !== null ? { ...p, call: { ...p.call, input: null } } : p)) } : m));

/** `savedOf(thread)`, held under the limit: the inputs of tool calls go first, then the oldest messages. */
export function blobOf(thread: Thread): SavedThread {
  let saved = savedOf(thread);
  const size = (value: unknown) => JSON.stringify(value).length;
  if (size(saved) <= SAVE_LIMIT) return saved;
  // The older versions go first: the conversation on screen matters more.
  if (saved.forks) {
    const { forks: _forks, ...rest } = saved;
    saved = rest;
    if (size(saved) <= SAVE_LIMIT) return saved;
  }
  const messages = withoutInputs(saved.messages);
  const lengths = messages.map(size);
  let total = size({ ...saved, messages: [] }) + lengths.reduce((a, b) => a + b + 1, 0);
  let from = 0;
  // The oldest go in pairs (a question and its answer), and the newest pair is always kept.
  while (total > SAVE_LIMIT && from + 2 < messages.length) {
    total -= (lengths[from] ?? 0) + (lengths[from + 1] ?? 0) + 2;
    from += 2;
  }
  return { ...saved, messages: messages.slice(from) };
}

// Reading a blob back: anything may be there, so every field is checked.

const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const CHIP_KINDS: ReadonlySet<string> = new Set<ChipKind>(["note", "board", "cards", "tag", "search", "deck", "slide", "diagram", "latex", "pdf", "attachment", "selection"]);
const SOURCES: ReadonlySet<string> = new Set(["page", "pdf", "latex", "slide"]);

/** A selection as saved: checked field by field, none when it does not hold together. */
function readSelection(raw: unknown): SelectionPayload | undefined {
  const { source, text: words, heading, range, pinned } = object(raw);
  const { kind, path, id } = object(source);
  if (typeof kind !== "string" || !SOURCES.has(kind) || typeof path !== "string" || typeof words !== "string") return undefined;
  const { from, to } = object(range);
  return {
    source: { kind: kind as SelectionSource["kind"], path, ...(typeof id === "string" ? { id } : {}) },
    text: words,
    ...(typeof heading === "string" ? { heading } : {}),
    ...(typeof from === "number" && typeof to === "number" ? { range: { from, to } } : {}),
    pinned: pinned === true,
  };
}
const STATUSES: ReadonlySet<string> = new Set<AnswerStatus>(["streaming", "done", "stopped", "error", "paused"]);
const FAILS: ReadonlySet<string> = new Set<FailKind>(["cancelled", "connection", "modelUnavailable", "permission", "rateLimited", "tooLong", "refused", "other"]);

function readChips(raw: unknown): Chip[] {
  return list(raw).flatMap((item): Chip[] => {
    const { kind, label, ref, origin, selection } = object(item);
    if (typeof kind !== "string" || !CHIP_KINDS.has(kind) || typeof label !== "string" || !Array.isArray(ref)) return [];
    const picked = kind === "selection" ? readSelection(selection) : undefined;
    // A selection without its text is nothing to send.
    if (kind === "selection" && !picked) return [];
    return [{ kind: kind as ChipKind, label, ref: ref.filter((r): r is string => typeof r === "string"), ...(picked ? { selection: picked } : {}), ...(origin === "auto" || origin === "pinned" || origin === "added" ? { origin } : {}) }];
  });
}

const readContext = (raw: unknown): ContextChip[] => readChips(raw).map(({ kind, label, ref, selection }) => ({ kind, label, ref, ...(selection ? { selection } : {}) }));

function readAttachments(raw: unknown): SentAttachment[] {
  return list(raw).flatMap((item): SentAttachment[] => {
    const { id, name, kind, label } = object(item);
    return typeof id === "string" && typeof name === "string" && (kind === "text" || kind === "image") ? [{ id, name, kind, label: typeof label === "string" ? label : name }] : [];
  });
}

function readParts(raw: unknown): Part[] {
  return list(raw).flatMap((item): Part[] => {
    const part = object(item);
    if (part["kind"] === "text" && typeof part["text"] === "string") return [{ kind: "text", text: part["text"] }];
    if (part["kind"] === "steer" && typeof part["text"] === "string") return [{ kind: "steer", text: part["text"] }];
    if (part["kind"] === "tool") {
      const call = object(part["call"]);
      if (typeof call["id"] !== "string" || typeof call["name"] !== "string") return [];
      const result = object(part["result"]);
      const done = typeof result["id"] === "string" ? { id: result["id"], ok: result["ok"] === true, summary: text(result["summary"]) ?? "", paths: list(result["paths"]).filter((p): p is string => typeof p === "string"), ...(result["staged"] === true ? { staged: true } : {}) } : null;
      return [{ kind: "tool", call: { id: call["id"], name: call["name"], input: call["input"] ?? null }, result: done }];
    }
    return [];
  });
}

function readMessage(raw: unknown): Message | null {
  const m = object(raw);
  const id = text(m["id"]) ?? newId("m");
  if (m["role"] === "user") {
    if (typeof m["text"] !== "string") return null;
    const attachments = readAttachments(m["attachments"]);
    return { id, role: "user", text: m["text"], context: readContext(m["context"]), ...(attachments.length ? { attachments } : {}) };
  }
  if (m["role"] === "assistant") {
    const status = typeof m["status"] === "string" && STATUSES.has(m["status"]) ? (m["status"] as AnswerStatus) : "done";
    const kind = typeof m["errorKind"] === "string" && FAILS.has(m["errorKind"]) ? (m["errorKind"] as FailKind) : undefined;
    const answer: Answer = {
      id,
      role: "assistant",
      turn: text(m["turn"]) ?? null,
      provider: text(m["provider"]) ?? "",
      model: text(m["model"]) ?? "",
      parts: readParts(m["parts"]),
      status,
      error: text(m["error"]) ?? null,
      pinned: text(m["pinned"]) ?? null,
      ...(kind ? { errorKind: kind } : {}),
      ...(text(m["notice"]) ? { notice: text(m["notice"])! } : {}),
      ...(typeof m["startedAt"] === "number" ? { startedAt: m["startedAt"] } : {}),
    };
    return answer;
  }
  return null;
}

const REASONS = ["rounds", "calls", "minutes", "loop", "length", "interrupted"] as const;

function readPause(raw: unknown): Paused | undefined {
  const { reason, detail } = object(raw);
  const found = REASONS.find((r) => r === reason);
  return found ? { reason: found, detail: text(detail)?.trim() || pauseDetail(found) } : undefined;
}

/** A thread from what `chat_load` gave: the window's copy, with the plan, the waiting messages and the place in the events from the backend, which has the later word. A thread that was working is working still: the events it missed come next (`chat_state`), then `reconcile`. */
export function restore(id: string, loaded: LoadedThread): Thread {
  const saved = object(loaded.ui);
  const messages = list(saved["messages"]).flatMap((raw) => readMessage(raw) ?? []);
  const plan = planOf(loaded.plan) ?? [];
  const waiting = list(loaded.queued).filter((t): t is string => typeof t === "string" && t.trim() !== "");
  // A chat in line for a place is under way too: its events come when it starts.
  const running = loaded.status === "running" || loaded.status === "waiting";
  const last = messages[messages.length - 1];
  // A turn under way has an answer to put its events in.
  if (running && !(last?.role === "assistant" && last.status === "streaming")) {
    messages.push({ id: newId("m"), role: "assistant", turn: null, provider: loaded.provider, model: loaded.model, parts: [], status: "streaming", error: null, pinned: null });
  }
  const settings = readSettings(saved["settings"]);
  const changes = object(saved["changes"]);
  const pause = readPause(saved["pause"]);
  const thread: Thread = {
    ...newThread(),
    id,
    created: typeof saved["created"] === "number" ? saved["created"] : Date.now(),
    provider: text(saved["provider"]) || loaded.provider || null,
    model: text(saved["model"]) || loaded.model || null,
    context: readChips(saved["context"]),
    messages,
    session: text(saved["session"]) ?? null,
    streaming: running,
    changed: saved["changed"] === true,
    undone: saved["undone"] === true,
    seq: loaded.seq,
  };
  if (loaded.archived) thread.archived = true;
  if (loaded.bound) thread.bound = loaded.bound;
  if (text(saved["title"])?.trim()) thread.title = text(saved["title"])!;
  if (typeof saved["follow"] === "boolean") thread.follow = saved["follow"];
  if (typeof saved["direct"] === "boolean") thread.direct = saved["direct"];
  if (typeof saved["auto"] === "boolean") thread.auto = saved["auto"];
  if (typeof saved["allowImages"] === "boolean") thread.allowImages = saved["allowImages"];
  if (Object.keys(settings).length) thread.settings = settings;
  if (typeof changes["id"] === "string" && typeof changes["count"] === "number" && changes["count"] > 0) {
    thread.changes = { id: changes["id"], count: changes["count"], paths: list(changes["paths"]).filter((p): p is string => typeof p === "string") };
  }
  if (plan.length) thread.plan = plan;
  const forks = readForks(saved["forks"], readMessage);
  if (forks.length) thread.forks = forks;
  if (waiting.length) thread.queued = waiting;
  if (pause && !running) thread.pause = pause;
  return thread;
}

/** Settles a restored thread once the events it missed are in: an answer still open when the backend says the turn is over is closed the way the backend says. */
export function reconcile(thread: Thread, status: RunStatus): Thread {
  const at = thread.messages.length - 1;
  const last = thread.messages[at];
  // Its events say it is over, whatever the status was when it was read.
  if (last?.role !== "assistant" || last.status !== "streaming") return thread.streaming ? { ...thread, streaming: false } : thread;
  if (status === "running" || status === "waiting") return thread.streaming ? thread : { ...thread, streaming: true };
  const close = (answer: Answer, rest: Partial<Thread> = {}): Thread => {
    const messages = thread.messages.slice();
    messages[at] = answer;
    return { ...thread, ...rest, messages, streaming: false, stopping: false, round: undefined };
  };
  switch (status) {
    case "interrupted":
      return close({ ...last, status: "paused", error: null }, { pause: thread.pause ?? { reason: "interrupted", detail: pauseDetail("interrupted") } });
    case "paused":
      return close({ ...last, status: "paused", error: null }, { pause: thread.pause ?? { reason: "rounds", detail: "Paused. Continue to let it go on." } });
    case "error":
      return close({ ...last, status: "error", error: "The answer stopped with an error.", errorKind: "other" });
    default:
      return close({ ...last, status: "done" });
  }
}

/** When a thread's copy is written. A change marks the thread; the copy is written once the changes pause for `delay`, but no later than `maxWait` after the first, and never two writes of one thread at once. */
export class Persister {
  private dirty = new Map<string, { first: number; last: number }>();
  /** The writes under way, by thread. */
  private busy = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dead = false;

  constructor(
    private write: (id: string) => Promise<void>,
    private options: { delay: number; maxWait: number } = { delay: 1500, maxWait: 10_000 },
  ) {}

  mark(id: string): void {
    if (this.dead) return;
    const now = Date.now();
    this.dirty.set(id, { first: this.dirty.get(id)?.first ?? now, last: now });
    this.arm();
  }

  /** Writes what is marked now, one thread or all, and waits for the writes under way. */
  async flush(id?: string): Promise<void> {
    const ids = id === undefined ? [...new Set([...this.dirty.keys(), ...this.busy.keys()])] : [id];
    await Promise.all(
      ids.map(async (one) => {
        // A write under way is waited for; what changed meanwhile is written after it.
        for (let round = 0; round < 3; round++) {
          await this.busy.get(one);
          if (!this.dirty.has(one)) return;
          await this.run(one);
        }
      }),
    );
  }

  dispose(): void {
    this.dead = true;
    this.dirty.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private due = (entry: { first: number; last: number }) => Math.min(entry.last + this.options.delay, entry.first + this.options.maxWait);

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // A thread being written is looked at again when its write ends.
    const waiting = [...this.dirty].filter(([id]) => !this.busy.has(id)).map(([, entry]) => entry);
    // Nothing waits, or the one that does is being written: its write ends with a look at it again.
    if (this.dead || waiting.length === 0) return;
    const next = Math.min(...waiting.map(this.due));
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = Date.now();
      for (const [id, entry] of [...this.dirty]) if (this.due(entry) <= now && !this.busy.has(id)) void this.run(id);
      this.arm();
    }, Math.max(0, next - Date.now()));
  }

  private run(id: string): Promise<void> {
    if (this.dead || this.busy.has(id) || !this.dirty.delete(id)) return Promise.resolve();
    const going = Promise.resolve()
      .then(() => this.write(id))
      .catch(() => {
        // The next change writes it again.
      })
      .finally(() => {
        this.busy.delete(id);
        // What changed during the write goes next.
        this.arm();
      });
    this.busy.set(id, going);
    return going;
  }
}
