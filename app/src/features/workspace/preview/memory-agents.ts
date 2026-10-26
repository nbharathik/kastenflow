// The browser preview's history and agents:
// every write is a version of its note, as every op is a commit in the core,
// and a note's versions go with it when it moves. What the chat's and the
// brainstorm's stand-ins write as an agent is kept as versions in the
// agent's session (agent-sessions.ts), notes, boards and decks alike, so History
// lists the session and undoing it reverts all of it, newest first, as the
// core does with git. Agents that connect over MCP need a vault on disk, so
// the preview has no proposals.

import type { AgentMark, AgentMode, AgentPolicy, AgentPolicyView, Checkpoint, DeckFile, Digest, NewNote, NoteFile, Proposal, Renamed, SessionInfo, Undone, VaultRestore } from "../../../lib/vault/types";
import { ended, timeOf } from "../../agents/policy";
import type { Brainstormed, Idea } from "../../chat/types";
import { blame } from "./agent-blame";
import { chatFile, digestIn, sessionEdits, sessionsIn, type Agent } from "./agent-sessions";
import { deckHead } from "./memory-decks";
import { MemoryDiagrams } from "./memory-diagrams";
import { addFiles, below, boardTitle, group, writeCanvas, type Canvas } from "./memory-extras";
import type { Version } from "./stored";
import { newId } from "./vault-text";

/** How many versions the preview keeps of each note or board. */
export const MAX_VERSIONS = 30;
/** Changes to one note within this span count as one version, like the core's batched commits. */
const BATCH_MS = 30_000;
/** The most ideas one brainstorm places (kasten-core `MAX_IDEAS`). */
const MAX_IDEAS = 20;
/** Inside a section around its cards; its label gets as much again on top. */
const PAD = 40;

/** The project a board belongs to: `projects/<p>/boards/…`. */
const projectOf = (board: string) => /^projects\/([^/]+)\/boards\/./.exec(board)?.[1] ?? null;

export class MemoryAgents extends MemoryDiagrams {
  /** The verb for the next version, when it is not an edit or create. */
  protected verb: string | null = null;
  /** The note being renamed, whose next version says so. */
  private renaming: { path: string; old: string } | null = null;

  protected override put(path: string, text: string): NoteFile {
    const existed = Boolean(this.data.files[path]);
    const note = super.put(path, text);
    const list = ((this.data.versions ??= {})[path] ??= []);
    const last = list[list.length - 1];
    const renamed = this.renaming?.path === path ? this.renaming : null;
    if (renamed) this.renaming = null;
    const summary = renamed ? `rename: ${renamed.old} → ${note.meta.title}` : `${this.verb ?? (existed ? "edit" : "create")}: ${note.meta.title}`;
    // An agent's version stays its own: a person's edit after it is a new one.
    if (!renamed && !this.verb && last && existed && !last.session && last.summary.startsWith("edit:") && this.now() - last.time < BATCH_MS) {
      last.text = text;
      last.time = this.now();
    } else this.keepVersion(path, { id: newId(this.now()), time: this.now(), summary, text });
    this.persist();
    return note;
  }

  override async rename(path: string, title: string): Promise<Renamed> {
    this.renaming = { path, old: this.get(path).meta.title };
    try {
      return await super.rename(path, title);
    } finally {
      this.renaming = null;
    }
  }

  protected override carry(from: string, to: string): void {
    const versions = this.data.versions;
    if (versions?.[from]) {
      versions[to] = [...versions[from], ...(versions[to] ?? [])];
      delete versions[from];
    }
    if (this.renaming?.path === from) this.renaming.path = to;
  }

  async proposals(): Promise<Proposal[]> {
    return [];
  }

  async acceptProposal(): Promise<unknown> {
    throw new Error("The browser preview has no agent proposals");
  }

  async rejectProposal(): Promise<void> {
    throw new Error("The browser preview has no agent proposals");
  }

  async sessions(limit = 50): Promise<SessionInfo[]> {
    return sessionsIn(this.data.versions ?? {}, limit);
  }

  async activityDigest(since: number): Promise<Digest> {
    return digestIn(this.data.versions ?? {}, since);
  }

  /** Reverts a session's versions newest first, each as a new version; a
   * note or board changed since stops it, as the core stops at a conflict. */
  async undoSession(session: string): Promise<Undone> {
    const reverted: string[] = [];
    for (const { path, version, before } of sessionEdits(this.data.versions ?? {}, session)) {
      const stop = (detail: string): Undone => ({ reverted, conflict: { commit: version.id, summary: version.summary, path, detail } });
      const board = path.endsWith(".canvas");
      const deck = path.endsWith(".deck");
      const current = (board ? this.data.boards?.[path] : deck ? this.data.decks?.[path] : this.data.files[path]?.text) ?? null;
      if (current !== version.text) return stop("It changed after the session wrote it");
      const made = version.summary.startsWith("create:");
      // A board's or a deck's version keeps it as it was; a note's is the version before.
      const back = version.before !== undefined ? version.before : before?.text;
      if (!made && typeof back !== "string") return stop("The preview no longer keeps the version before it");
      // Written without a version of its own: the undo's version follows.
      if (made) await this.trash(path);
      else if (board) this.data.boards![path] = back!;
      else if (deck) this.data.decks![path] = back!;
      else super.put(path, back!);
      const text = made ? null : back!;
      this.keepVersion(path, { id: newId(this.now()), time: this.now(), summary: `undo: ${version.summary}`, text, undoes: version.id, ...(board || deck ? { before: current } : {}) });
      reverted.push(version.id);
    }
    this.persist();
    return { reverted, conflict: null };
  }

  /** An agent's new note with its body, which ends in a newline as the
   * core writes it (an empty one keeps the new note's own): its versions
   * carry the agent's session. */
  async agentCreate(agent: Agent, note: NewNote, body: string): Promise<NoteFile> {
    const known = new Set(Object.values(this.data.versions ?? {}).flatMap((list) => list.map((v) => v.id)));
    const made = await this.create(note);
    const text = body.trim() ? (body.endsWith("\n") ? body : `${body}\n`) : null;
    const saved = text === null ? made : (await this.saveBody(made.meta.path, text, made.hash)).note;
    for (const version of this.data.versions?.[made.meta.path] ?? []) if (!known.has(version.id)) Object.assign(version, agent);
    this.persist();
    return saved;
  }

  /** The core's `brainstorm`: a card for each idea, in the board's project
   * or else the inbox, put on the board in a grid, and a section called
   * `label` around them below what is there, all as `agent`. */
  async brainstorm(agent: Agent, board: string, label: string, ideas: readonly Idea[], date: string): Promise<Brainstormed> {
    const kept = ideas.filter((idea) => idea.title.trim());
    if (kept.length === 0) throw new Error("A brainstorm needs at least one idea with a title");
    if (kept.length > MAX_IDEAS) throw new Error(`A brainstorm places at most ${MAX_IDEAS} ideas, not ${kept.length}`);
    this.canvas(board);
    const project = projectOf(board);
    const cards: string[] = [];
    for (const idea of kept) cards.push((await this.agentCreate(agent, { kind: "card", title: idea.title.trim(), date, project }, idea.text.trim())).meta.path);
    const { nodes } = this.agentEditBoard(agent, board, (canvas) => {
      const [x, y] = below(canvas);
      const added = addFiles(canvas, cards, [x + PAD, y + 2 * PAD]);
      const n = added.created.length;
      return [added, `add ${n} card${n === 1 ? "" : "s"}`];
    });
    const name = label.trim() || "Brainstorm";
    const section = this.agentEditBoard(agent, board, (canvas) => [group(canvas, nodes, name), `section ${name}`]);
    return { session: agent.session, cards, section };
  }

  /** An agent's edit of a board, kept as a version of its session with the
   * board as it was: a person's board edits keep no versions here. */
  private agentEditBoard<T>(agent: Agent, path: string, edit: (canvas: Canvas) => [T, string]): T {
    const before = this.data.boards?.[path] ?? null;
    const canvas = this.canvas(path);
    const [result, what] = edit(canvas);
    const text = writeCanvas(canvas);
    (this.data.boards ??= {})[path] = text;
    this.keepVersion(path, { id: newId(this.now()), time: this.now(), summary: `board: ${what} on ${boardTitle(path, canvas)}`, text, before, ...agent });
    this.persist();
    return result;
  }

  /** An agent's edit of a deck, kept as a version of its session with the deck as it was (as a board's is): a person's
   * saves of a deck keep none here. Nothing is written when the text is the deck's already. */
  async agentEditDeck(agent: Agent, path: string, text: string, summary: string): Promise<DeckFile> {
    deckHead(text);
    const before = this.data.decks?.[path];
    if (before === undefined) throw new Error(`No deck at ${path}`);
    if (before !== text) {
      this.data.decks![path] = text;
      this.keepVersion(path, { id: newId(this.now()), time: this.now(), summary: `deck: ${summary}`, text, before, ...agent });
      this.persist();
    }
    return this.deck(path);
  }

  /** Adds a version, keeping the latest MAX_VERSIONS. */
  protected keepVersion(path: string, version: Version): void {
    const list = ((this.data.versions ??= {})[path] ??= []);
    list.push(version);
    if (list.length > MAX_VERSIONS) list.splice(0, list.length - MAX_VERSIONS);
  }

  /** A chat transcript kept as a note in chats/ (the core's `save_chat`). */
  async saveChat(title: string, markdown: string): Promise<NoteFile> {
    const { stem, text } = chatFile(title, markdown, this.now());
    return this.put(this.freePath("chats", stem), text);
  }

  async trustSession(): Promise<void> {}

  /** How much agents may do, kept while the page is open: the preview's stand-in agents have no MCP to hold back. */
  private policy: AgentPolicy = { mode: "balanced", until: null, projects: {} };

  async agentPolicy(): Promise<AgentPolicyView> {
    const now = this.now();
    // A time box that has run out is over, for the vault and for a project.
    const holds = (mode: AgentMode): AgentMode => (mode === "autonomous" && ended(this.policy.until, now) ? "balanced" : mode);
    return {
      mode: this.policy.mode,
      until: this.policy.until,
      projects: { ...this.policy.projects },
      active: holds(this.policy.mode),
      autonomousProjects: Object.entries(this.policy.projects)
        .filter(([, mode]) => holds(mode) === "autonomous")
        .map(([folder]) => folder),
    };
  }

  async setAgentPolicy(policy: AgentPolicy): Promise<AgentPolicyView> {
    if (policy.until && timeOf(policy.until) === null) throw new Error(`“${policy.until}” is not a date and time (for example 2026-12-01 18:00)`);
    this.policy = { mode: policy.mode, until: policy.until || null, projects: { ...policy.projects } };
    return this.agentPolicy();
  }

  async checkpoints(): Promise<Checkpoint[]> {
    return [];
  }

  async restoreToCheckpoint(_id: string): Promise<VaultRestore> {
    throw new Error("The browser preview keeps no restore points");
  }

  /** The lines an agent wrote that nobody has edited or accepted since
   * (agent-blame.ts). */
  async agentMarks(path: string): Promise<AgentMark[]> {
    return this.data.files[path] ? blame(this.data.versions?.[path] ?? []) : [];
  }

  /** Keeps the agent's writing as it stands: a version of its own, as the
   * core's accept commit, when there is anything to accept. */
  async acceptAgentMarks(path: string): Promise<void> {
    if ((await this.agentMarks(path)).length === 0) return;
    const note = this.get(path);
    this.keepVersion(path, { id: newId(this.now()), time: this.now(), summary: `accept: ${note.meta.title}`, text: note.text });
    this.persist();
  }

  async agentMarked(paths: string[]): Promise<string[]> {
    const marked: string[] = [];
    for (const path of paths) if ((await this.agentMarks(path)).length > 0) marked.push(path);
    return marked;
  }
}
