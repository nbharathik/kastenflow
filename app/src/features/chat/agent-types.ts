// What the agent harness adds to the chat's contract with the app: attachments,
// the plan, pauses, saved threads and their state, the budgets, and the
// connection report. Names are camelCase, as serde sends them.

import type { ChatEvent } from "./types";

/** What an attachment is to the model: text it reads, or a picture it sees. */
export type AttachKind = "text" | "image";

/** An attachment as a message names it. */
export interface AttachmentRef {
  id: string;
  name: string;
  kind: AttachKind;
}

/** An attachment as the backend keeps it (`chat_attach`). */
export interface AttachmentInfo {
  id: string;
  kind: AttachKind;
  name: string;
  mime: string;
  bytes: number;
  /** For text: how many characters it comes to. */
  chars?: number;
  /** For a picture: its size in pixels. */
  width?: number;
  height?: number;
}

export type PlanStatus = "todo" | "doing" | "done";

/** One step of the plan the assistant keeps for a long task. */
export interface PlanItem {
  id: string;
  text: string;
  status: PlanStatus;
}

/** Why a turn is paused and not over. */
export type PauseReason = "rounds" | "calls" | "minutes" | "loop" | "length" | "interrupted";

export interface Paused {
  reason: PauseReason;
  /** A sentence for the person. */
  detail: string;
}

/** Where a thread is on the backend. `waiting`: it is in line for a free place (Settings → AI → Chat panel). */
export type RunStatus = "idle" | "running" | "waiting" | "paused" | "interrupted" | "error";

/** What a thread is tied to: a page, deck, diagram or LaTeX document. A note is found by its `id`, the rest by path. */
export interface Binding {
  kind: "page" | "deck" | "board" | "diagram" | "latex";
  path: string;
  id?: string;
}

/** One saved thread, for the list (`chat_threads`). */
export interface ThreadSummary {
  id: string;
  title: string;
  /** When it last changed, in milliseconds since the epoch. */
  updated: number;
  status: RunStatus;
  provider: string;
  model: string;
  /** Moved out of the list by its size; still saved and loadable. */
  archived?: boolean;
  /** The thing it is tied to, when it is. */
  bound?: Binding | null;
}

/** A saved thread (`chat_load`): the window's own copy of it, and where the backend is. */
export interface LoadedThread {
  /** What `chat_save_ui` stored, or null. */
  ui: unknown;
  status: RunStatus;
  /** The highest event number the saved copy had taken in, else the thread's last. */
  seq: number;
  plan: PlanItem[];
  title: string;
  provider: string;
  model: string;
  /** Messages still waiting for the turn's next step. */
  queued: string[];
  archived?: boolean;
  bound?: Binding | null;
  /** Events after the saved screen that `chat_state` can no longer replay. */
  gap?: { from: number; to: number } | null;
}

/** Why a saved chat could not be brought back (`chat_load` rejects with this). */
export interface AdoptFailure {
  kind: "adoptFailed";
  reason: "missing" | "damaged" | "newer";
  message: string;
}

/** The answer to `chat_delete_archived`. */
export interface DeletedArchived {
  deleted: string[];
  count: number;
  skipped: { id: string; reason: string }[];
}

/** How many chats the list keeps and how many may work at once (`chat_limits`). */
export interface ChatLimits {
  listSize: number;
  maxConcurrent: number;
}

export const DEFAULT_CHAT_LIMITS: ChatLimits = { listSize: 30, maxConcurrent: 3 };

/** The ranges `set_chat_limits` accepts. */
export const CHAT_LIMIT_RANGES = { listSize: { min: 10, max: 200 }, maxConcurrent: { min: 1, max: 8 } } as const;

/** What `chat_import_bindings` did. */
export interface ImportedBindings {
  bound: number;
  missing: number;
  kept: number;
}

/** Reads what `chat_load` rejected with: the typed failure, else none. */
export function adoptFailureOf(error: unknown): AdoptFailure | null {
  if (!error || typeof error !== "object") return null;
  const { kind, reason, message } = error as Record<string, unknown>;
  if (kind !== "adoptFailed" || typeof message !== "string") return null;
  return { kind, reason: reason === "damaged" || reason === "newer" ? reason : "missing", message };
}

/** What a thread did since `sinceSeq` (`chat_state`). */
export interface ChatSnapshot {
  status: RunStatus;
  seq: number;
  events: ChatEvent[];
  /** Some events were dropped from the backend's ring: load the thread again. */
  gap: boolean;
}

/** How much one turn may do before it pauses (Settings → AI → Agent limits). */
export interface ChatBudgets {
  /** Steps (rounds of the model). */
  rounds: number;
  /** Tool calls. */
  calls: number;
  minutes: number;
}

/** The bounds `set_chat_budgets` accepts. */
export const BUDGET_LIMITS = { rounds: { min: 1, max: 1000 }, calls: { min: 1, max: 5000 }, minutes: { min: 1, max: 240 } } as const;

export const DEFAULT_BUDGETS: ChatBudgets = { rounds: 80, calls: 250, minutes: 30 };

/** How far a request got, or where it stopped. */
export type RequestStage = "signIn" | "renewal" | "modelList" | "request" | "stream";

/** One request in the connection report (`chat_diagnostics`): never a token, email, prompt or answer. */
export interface RequestOutcome {
  /** Milliseconds since 1970. */
  at: number;
  /** `anthropic`, `openai` or `chatgpt`. */
  provider: string;
  model: string;
  /** The host and path asked. */
  route: string;
  ok: boolean;
  /** The last stage reached; the one that failed when `ok` is false. */
  stage: RequestStage;
  status: number | null;
  kind: string | null;
  /** Why, in one word (`timeout`, `closed`, `cut`, a provider's error code); empty when it worked. */
  reason: string;
  attempts: number;
  /** Until the first piece of the answer, in milliseconds. */
  firstByteMs: number | null;
  totalMs: number;
  /** The sign-in's token was renewed for it. */
  renewed: boolean;
  /** The connection pool was made again for it. */
  rebuilt: boolean;
}
