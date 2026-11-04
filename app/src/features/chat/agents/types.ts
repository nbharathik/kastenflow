// What the window knows of the coding agents (Claude Code, OpenCode): the
// programs found on this computer, how "Test" went, and the questions an agent
// asks that the chat shows as cards. camelCase, as the backend sends it.

/** An agent as Settings shows it. */
export interface AgentInfo {
  id: "claude-code" | "opencode";
  label: string;
  /** The name a thread uses it by (a provider name). */
  provider: string;
  found: boolean;
  /** Where its program is. */
  path: string | null;
  version: string | null;
  /** How to install it, in words. */
  install: string;
  /** How to sign in to it, in words. */
  signIn: string;
}

/** How "Test" went. */
export interface AgentCheck {
  ok: boolean;
  version: string | null;
  /** Whether the CLI says it is signed in; null when it did not say. */
  signedIn: boolean | null;
  message: string;
}

/** Where an agent's question stands. */
export type ApprovalState = "asking" | "allowed" | "denied" | "over";

/** A question from an agent: a card with Allow and Deny (the `approval` event). */
export interface Approval {
  /** What the answer names. */
  id: string;
  /** "Claude Code" */
  agent: string;
  tool: string;
  /** "Allow Claude Code to run a command?" */
  question: string;
  /** The command, the file or the input, shortened. */
  detail: string;
  state: ApprovalState;
}
