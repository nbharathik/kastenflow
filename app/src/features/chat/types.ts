// The chat's side of its contract with the app (app/src-tauri): what the
// commands take and give, and the events an answer streams as. Names are
// camelCase, as serde sends them. What the agent harness adds (attachments,
// the plan, saved threads) is in agent-types.ts.

import type { AttachmentRef } from "./agent-types";

/** The kinds of provider an API key goes with. */
export type ProviderKind = "anthropic" | "openai";

/** Every kind of provider: those, and "chatgpt", which signs in with the
 * person's ChatGPT account instead of taking a key or an address. */
export type ChatKind = ProviderKind | "chatgpt";

/** An AI endpoint chats can use: the Anthropic API, any OpenAI-compatible
 * server or the ChatGPT plan. Its key stays in the system keychain; the
 * window only learns whether one is stored (for ChatGPT, whether Kasten is
 * signed in). */
export interface ChatProvider {
  name: string;
  kind: ChatKind;
  baseUrl: string;
  /** The model a new chat starts with. */
  model: string;
  hasKey: boolean;
  /** Whether notes may go to its address from this computer: its own API,
   * this computer, or an address confirmed here. */
  confirmed: boolean;
}

/** A provider that takes a key and an address: not ChatGPT. */
export type KeyedProvider = ChatProvider & { kind: ProviderKind };

export const isKeyed = (provider: ChatProvider): provider is KeyedProvider => provider.kind !== "chatgpt";

/** A provider as Settings sends it. */
export type ProviderDraft = Omit<ChatProvider, "hasKey" | "confirmed">;

/** How "Test connection" went: one short request, as a chat sends it. */
export interface ProviderCheck {
  ok: boolean;
  model: string;
  /** How long the answer took. */
  millis: number;
  /** The start of what the model said. */
  reply: string;
  /** That it works, or why not and what to check. */
  message: string;
}

/** What AI is asked to do in the page editor. "explain" answers the person
 * about the selection; its answer is read, never put in the page. */
export type WriteAction = "ask" | "continue" | "summarize" | "explain";

/** How much of the page "explain" is given around the selection. */
export type ExplainScope = "nearby" | "page";

/** One request from the page editor: no tools, the page as data. */
export interface WriteRequest {
  /** Made by the editor, to stop the answer by. */
  id: string;
  provider: string;
  /** Empty means the provider's own model. */
  model: string;
  action: WriteAction;
  /** What the person asked, for "ask". */
  instruction: string;
  title: string;
  /** The selected Markdown; for "summarize", the whole page. */
  selection: string;
  /** Some of the page before the selection or cursor, and after it; with the
   * "page" scope, all of it (the backend cuts it). */
  before: string;
  after: string;
  /** For "explain"; left out means "nearby". */
  scope?: ExplainScope;
}

/** What an AI action works from (the frontmatter's `needs` and `optional`). */
export type ActionNeed = "selection" | "page" | "nearby" | "sources" | "pdf" | "highlights" | "project" | "journal";
/** What an action does with its answer: it is only read, goes into the page,
 * or becomes a change to review. */
export type ActionWrites = "none" | "insert" | "propose";
/** Where an action is offered. */
export type ActionPlace = "editor" | "chat" | "pdf";

/** An AI action, built in or from the vault's `templates/ai/`. */
export interface AiAction {
  slug: string;
  title: string;
  /** A name from the app's icon set. */
  icon: string;
  needs: ActionNeed[];
  optional: ActionNeed[];
  writes: ActionWrites;
  where: ActionPlace[];
  version: number;
  /** What it does, in words: the file's body. */
  instruction: string;
  builtIn: boolean;
  /** The vault file it comes from, when it does. */
  path: string | null;
}

/** A vault file that could not be used as an action, and why. */
export interface ActionProblem {
  slug: string;
  path: string;
  message: string;
}

export interface ActionCatalog {
  actions: AiAction[];
  problems: ActionProblem[];
}

/** The text of one page of a PDF, read in the window. */
export interface Excerpt {
  source: string;
  /** From 1. */
  page: number;
  text: string;
}

/** One run of an action (`ai_action_run`): what the editor or the reader has to give it. */
export interface ActionRun {
  /** Made by the window, to stop the answer by. */
  id: string;
  action: string;
  provider: string;
  model: string;
  /** Words the person added. */
  instruction?: string;
  title?: string;
  selection?: string;
  before?: string;
  after?: string;
  page?: string;
  context?: ContextChip[];
  excerpts?: Excerpt[];
  /** The folder of the project the page belongs to. */
  project?: string | null;
  /** The person's day, YYYY-MM-DD. */
  date?: string | null;
}

/** The whole answer, once it ends. */
export interface Written {
  text: string;
  /** Stopped before its end. */
  stopped: boolean;
  /** Why it may be incomplete, when it may be. */
  note: string | null;
}

export type ChipKind = "note" | "board" | "cards" | "tag" | "search" | "deck" | "slide" | "diagram" | "pdf" | "attachment";

/** Something a chat is grounded in. `ref` names it: a note [path], a board
 * [board path], cards [note paths], a tag view [tag, view name?], search
 * results [query], a slide deck [deck path], the slide someone is looking at
 * [deck path, slide id, ...the ids of the selected elements], a diagram
 * [diagram path, page name?], pages and highlights of a PDF [source,
 * "pages:3-5", "highlights:id,id"] or an attachment [id, name, kind] (these
 * are in a saved transcript only: a request names attachments in
 * `attachments`). */
export interface ContextChip {
  kind: ChipKind;
  label: string;
  ref: string[];
}

export interface ChatRequest {
  /** The thread's id, made by the window. */
  chat: string;
  provider: string;
  model: string;
  text: string;
  context: ContextChip[];
  /** The person's day, YYYY-MM-DD, for "today" in the prompt; the
   * backend falls back to UTC's day. */
  date?: string;
  /** What the person set for this thread's model; left out, the provider's defaults. */
  settings?: GenerationSettings;
  /** The text of the PDF pages the `pdf` chips name, read in the window. */
  excerpts?: Excerpt[];
  /** How the chat's writes reach the vault; left out, they wait as staged changes. */
  writes?: WriteMode;
  /** Files kept with `chat_attach` that go with this message. */
  attachments?: AttachmentRef[];
}

/** `preview` holds the chat's writes as staged changes for the person to review
 * (the default); `direct` makes them at once, through the same guardrails. */
export type WriteMode = "preview" | "direct";

/** How hard a reasoning model thinks before it answers. */
export type Effort = "minimal" | "low" | "medium" | "high";

/** What the person may set for a model's answers (the Advanced popover). Each
 * is left out for the provider's own default; the backend refuses one the
 * model does not take (chat/capabilities). */
export interface GenerationSettings {
  reasoningEffort?: Effort;
  /** Tokens a Claude model may think with; on means no temperature. */
  thinkingBudget?: number;
  temperature?: number;
  maxOutputTokens?: number;
  /** Send pictures to a model whose reading of them is not known (a local
   * server's): the person's choice to try. */
  allowImages?: boolean;
}

/** Why a turn failed, so the message can offer a way on. */
export type FailKind = "cancelled" | "connection" | "modelUnavailable" | "permission" | "rateLimited" | "tooLong" | "refused" | "other";

export interface ChatTurn {
  chat: string;
  /** The thread's agent session: everything the chat changes is in it. */
  session: string;
  turn: string;
  /** The message was sent while a turn ran: it waits for the next step and starts no turn of its own. */
  queued?: boolean;
}

/** The model called a tool. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** What a tool did; `paths` are the notes and boards it touched. */
export interface ToolResult {
  id: string;
  ok: boolean;
  summary: string;
  paths: string[];
  /** Held in the thread's staged changes, not written to the vault. */
  staged?: boolean;
}

/** What a thread's staged changes come to (the `changes` event). */
export interface ChangesInfo {
  /** The change set's id. */
  id: string;
  /** Files changed or made, and pictures added. */
  count: number;
  paths: string[];
}

/** What a staged file is. */
export type StagedKind = "note" | "deck" | "diagram" | "board";

/** One file of the staged changes, before and after. */
export interface FileChange {
  path: string;
  kind: StagedKind;
  title: string;
  /** The chat makes this file; it is not in the vault. */
  new: boolean;
  /** The file as the vault had it when the chat first changed it; null for a new file. */
  before: string | null;
  after: string;
  /** The change as a unified diff. */
  diff: string;
  /** The vault changed it since, in a way that cannot be put together with the chat's change. */
  stale: boolean;
  /** For a diagram: the program's drawing of it before and after, as SVG text. Left out when it could not draw that version. */
  beforeSvg?: string;
  afterSvg?: string;
}

export interface PictureChange {
  path: string;
  name: string;
  bytes: number;
}

/** One thing the chat did, in words. */
export interface StepChange {
  summary: string;
  paths: string[];
}

/** Everything a thread has staged (`chat_changes`). */
export interface ChangesView {
  id: string;
  files: FileChange[];
  pictures: PictureChange[];
  steps: StepChange[];
}

/** What applying the staged changes came to. */
export type ApplyResult = { status: "applied"; commit: string | null; paths: string[] } | { status: "stale"; files: string[] };

/** What recalculating the staged changes could not make again. */
export interface Recalculated {
  dropped: { summary: string; why: string }[];
}

/** One piece of an answer (the `chat-event` event). Per turn: any mix of
 * text, tool and toolResult, then exactly one done or error. */
export interface ChatEvent {
  chat: string;
  turn: string;
  kind: "text" | "tool" | "toolResult" | "done" | "error" | "notice" | "changes" | "plan" | "paused" | "queued" | "round" | "thinking";
  /** Counts the chat's events, each more than the last, so a window that was
   * away can ask for what it missed. */
  seq?: number;
  /** The next piece of the answer. */
  text?: string;
  tool?: ToolCall;
  result?: ToolResult;
  /** A done that Stop asked for. */
  stopped?: boolean;
  error?: string;
  /** What kind of failure the error is. */
  errorKind?: FailKind;
  /** For `changes`: the thread's staged changes now. */
  changes?: ChangesInfo;
  /** For `plan`: the whole plan; an empty list clears it. thread-events.ts reads
   * the harness's fields leniently, so they are typed loosely here. */
  plan?: unknown;
  /** For `paused`: why (`rounds`, `calls`, `minutes`, `loop`, `length`,
   * `interrupted`) and the sentence to show. Not an error. */
  reason?: string;
  detail?: string;
  /** For `round`: the steps so far in this turn, and the tool calls made. */
  n?: number;
  calls?: number;
  /** For a `notice`: what it is about, such as "retry". */
  code?: string;
  /** For `queued`: whether the turn has taken the message up (false while it waits). */
  delivered?: boolean;
}

/** The most ideas one brainstorm places (kasten-core `MAX_IDEAS`). */
export const MAX_IDEAS = 20;

/** "Brainstorm on this board" (the `brainstorm_board` command). */
export interface BrainstormRequest {
  board: string;
  /** What the ideas are about; empty for whatever moves the board on. */
  topic: string;
  /** How many ideas, 1 to MAX_IDEAS. */
  count: number;
  provider: string;
  model: string;
}

/** One idea: a card's title and its text. */
export interface Idea {
  title: string;
  text: string;
}

/** What a brainstorm placed, all in one agent session. */
export interface Brainstormed {
  session: string;
  /** The new cards' paths, in the ideas' order. */
  cards: string[];
  /** The id of the section around them. */
  section: string;
}
