// The chat's side of its contract with the app (app/src-tauri): what the
// commands take and give, and the events an answer streams as. Names are
// camelCase, as serde sends them.

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

/** What AI is asked to do in the page editor. */
export type WriteAction = "ask" | "continue" | "summarize";

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
  /** Some of the page before the selection or cursor, and after it. */
  before: string;
  after: string;
}

/** The whole answer, once it ends. */
export interface Written {
  text: string;
  /** Stopped before its end. */
  stopped: boolean;
  /** Why it may be incomplete, when it may be. */
  note: string | null;
}

export type ChipKind = "note" | "board" | "cards" | "tag" | "search" | "deck" | "slide";

/** Something a chat is grounded in. `ref` names it: a note [path], a board
 * [board path], cards [note paths], a tag view [tag, view name?], search
 * results [query], a slide deck [deck path] or the slide someone is looking at
 * [deck path, slide id, ...the ids of the selected elements]. */
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
}

export interface ChatTurn {
  chat: string;
  /** The thread's agent session: everything the chat changes is in it. */
  session: string;
  turn: string;
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
}

/** One piece of an answer (the `chat-event` event). Per turn: any mix of
 * text, tool and toolResult, then exactly one done or error. */
export interface ChatEvent {
  chat: string;
  turn: string;
  kind: "text" | "tool" | "toolResult" | "done" | "error";
  /** The next piece of the answer. */
  text?: string;
  tool?: ToolCall;
  result?: ToolResult;
  /** A done that Stop asked for. */
  stopped?: boolean;
  error?: string;
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
