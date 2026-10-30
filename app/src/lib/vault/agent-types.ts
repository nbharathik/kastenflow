// What agents did and asked: proposals
// waiting for review, sessions, the files a commit changed, and the lines
// an agent wrote that no one has read yet.

/** An agent op, as stored in a proposal: `kind` and its arguments. */
export type AgentOp = { kind: string } & Record<string, unknown>;

export interface Proposal {
  id: string;
  created: string;
  session: string;
  client: string;
  status: "pending" | "accepted" | "rejected";
  op: AgentOp;
  target: { path: string; title: string } | null;
  /** Why it waits for review. */
  reason: string;
  /** The agent's own reason. */
  note: string | null;
  diff: string;
  before: string | null;
  after: string | null;
  decided: string | null;
  decidedBy: string | null;
}

export interface SessionInfo {
  id: string;
  client: string;
  started: number;
  last: number;
  commits: number;
  undone: boolean;
}

/** One agent session's share of a day (the core's `activity_digest`). Only
 * what agents did: a person's edits are never in it. */
export interface DigestSession {
  id: string;
  /** The name the agent connected under, such as `routine: conference tracking`. */
  client: string;
  started: number;
  last: number;
  /** Changes made inside the window. */
  changes: number;
  /** Changes it asked you to decide on, inside the window. */
  proposed: number;
  notesTouched: number;
  /** Paths of the first few notes it touched. */
  notes: string[];
  /** `autonomous` when it worked on its own. */
  mode: string | null;
  proposalsWaiting: number;
  /** Something of the session can still be taken back. */
  canUndo: boolean;
  undone: boolean;
}

export interface Digest {
  /** The window's start, in milliseconds since the Unix epoch. */
  since: number;
  /** Sessions that changed something in the window, newest first. */
  sessions: DigestSession[];
  changes: number;
  waiting: number;
}

/** One file a commit changed. */
export interface ChangedFile {
  path: string;
  before: string | null;
  after: string | null;
}

export interface Undone {
  reverted: string[];
  conflict: { commit: string; summary: string; path: string; detail: string } | null;
}

/** Lines of a note one agent commit wrote that you have not edited or
 * accepted. */
export interface AgentMark {
  /** The first line, from 0 in the body (the text after the frontmatter). */
  start: number;
  /** The line after the last. */
  end: number;
  session: string;
  /** The agent's client, such as `claude-code`. */
  client: string;
  commit: string;
  /** Milliseconds since the Unix epoch. */
  time: number;
}
