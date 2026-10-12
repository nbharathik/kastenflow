// The vault as the frontend sees it: the shapes kasten-core's ops return
// (serde, camelCase) and the client every view talks to.

import type { AgentMark, ChangedFile, Proposal, SessionInfo, Undone } from "./agent-types";
import type { AssetOps } from "./asset-types";
import type { BoardAdded, BoardApplied, BoardChange, BoardInfo, BoardView } from "./board-types";
import type { DeckFile, DeckInfo, DeckSaved } from "./deck-types";
import type { DiagramOps } from "./diagram-types";
import type { GraphOps } from "./graph-types";
import type { ImportOps } from "./import-types";
import type { ReplaceOps } from "./replace-types";
import type { SourceOps } from "./source-types";

export type NoteKind = "page" | "card" | "journal" | "project" | "highlight" | "chat";

export interface NoteMeta {
  /** Vault-relative path; the note's handle in every call. */
  path: string;
  id: string | null;
  title: string;
  /** `page`, `card`, `journal`, `project` or `template`. */
  kind: string;
  icon: string | null;
  cover: string | null;
  /** Id of the parent page, for sub-pages. */
  parent: string | null;
  /** Folder name under `projects/`. */
  project: string | null;
  tags: string[];
  /** Last change, in milliseconds since the Unix epoch. */
  modified: number;
  /** `created` and `updated` from the frontmatter, as written. */
  created: string | null;
  updated: string | null;
  /** The first readable text, for cards and previews. */
  excerpt: string;
  words: number;
  /** Tag property values. */
  props: Record<string, unknown>;
  /** Read-only for agents. */
  locked: boolean;
}

export interface NoteFile {
  meta: NoteMeta;
  text: string;
  /** Pass back when saving, so changes made meanwhile are noticed. */
  hash: string;
}

/** A note after an op that can move files: every [from, to] move the op
 * made, its sub-pages' included, and the other notes whose links it
 * rewrote. */
export interface Placed extends NoteFile {
  moves: [string, string][];
  relinked: string[];
}

export type Saved =
  | { status: "written"; note: NoteFile }
  | { status: "unchanged"; note: NoteFile }
  | { status: "conflict"; copy: string; note: NoteFile }
  /** The file changed elsewhere on other lines; both edits were kept. */
  | { status: "merged"; note: NoteFile };

export interface NewNote {
  kind: NoteKind;
  title: string;
  /** The local day, YYYY-MM-DD. */
  date: string;
  project?: string | null;
  /** Path of the parent page. */
  parent?: string | null;
  template?: string | null;
  icon?: string | null;
  /** Tags to add, and property values checked against their schemas: all
   * in the one commit that makes the note. */
  tags?: string[];
  props?: Record<string, unknown>;
  /** What the page says, written with it in the same commit: a draft's
   * first typing. */
  body?: string;
}

export interface Hit {
  path: string;
  title: string;
  icon: string | null;
  snippet: string;
  score: number;
}

/** A note that links a day (`[[2026-10-01]]`) outside a to-do. */
export interface DayMention {
  day: string;
  path: string;
  title: string;
  icon: string | null;
  /** `page`, `card`, `journal` or `project`, as in `NoteMeta`. */
  kind: string;
  /** The line that holds the link. */
  snippet: string;
  /** The time, `HH:MM`, written directly after the link
   * (`[[2026-10-07]] 09:00`), if any. */
  at?: string | null;
}

export interface Backlink {
  path: string;
  title: string;
  icon: string | null;
  snippet: string;
}

/** A note about the same things as another (the core's related notes). */
export interface RelatedNote {
  path: string;
  title: string;
  icon: string | null;
  /** Up to three words both notes use, the most telling first. */
  shared: string[];
  /** One links to the other already. */
  linked: boolean;
}

export interface Renamed {
  note: NoteFile;
  /** Other notes whose links now name the new title. */
  relinked: string[];
}

export interface Trashed {
  trashed: string;
  original: string;
  title: string;
  when: string;
  /** How many sub-pages went to the trash with it; they come back with it. */
  inside: number;
}

export interface TaskRow {
  path: string;
  title: string;
  icon: string | null;
  /** Line in the body, from 0. */
  line: number;
  done: boolean;
  text: string;
  /** The day the task names, YYYY-MM-DD (a day that exists on the calendar). */
  due: string | null;
  /** The time, `HH:MM` (24 hours), that directly follows that day link or
   * `@date` (`[[2026-10-07]] 09:00`), if any. */
  at?: string | null;
}

/** What restoring the whole vault did. */
export interface VaultRestore {
  /** Files written back to their old text. */
  written: string[];
  /** Where files made after the point went, under `.trash/`. */
  trashed: string[];
  /** The commit the restore made, which undo takes back whole. */
  commit: string | null;
}

export interface CommitInfo {
  id: string;
  summary: string;
  message: string;
  author: string;
  /** Milliseconds since the Unix epoch. */
  time: number;
  agent: boolean;
  session: string | null;
  op: string | null;
  /** Who accepted the agent's proposal. */
  approvedBy: string | null;
  /** The commit this one undoes. */
  undoes: string | null;
  /** It joins two lines of history, as getting the latest does; it can't
   * be undone as one change. */
  merge?: boolean;
}

/** `unconfirmed`: the vault names a remote no one confirmed on this
 * computer, so nothing is pushed there yet. */
export type BackupState = "off" | "ok" | "stale" | "failing" | "unconfirmed";

export interface BackupStatus {
  state: BackupState;
  lastPush: number | null;
  failures: number;
  lastError: string | null;
  /** The last push was refused because the backup has changes this
   * computer lacks: get the latest first. */
  behind?: boolean;
}

/** How the backup files in a sync or disk folder stand. */
export interface BackupFileStatus {
  state: BackupState;
  lastWritten: number | null;
  path: string | null;
  /** The newest file holds every commit there is now. */
  current: boolean;
  failures: number;
  lastError: string | null;
}

export interface VaultStatus {
  name: string;
  root: string;
  /** Whether the vault keeps git history. */
  history: boolean;
  remote: string | null;
  backup: BackupStatus;
  /** Edits waiting for their commit. */
  pending: number;
  /** The folder backup files go to on this computer (desktop only). */
  backupFolder?: string | null;
  backupFile?: BackupFileStatus | null;
  /** This computer's name, which its backup files carry. */
  computer?: string;
  /** A Get latest stopped part way and waits to be finished. */
  unfinished?: boolean;
  /** The sync app whose folder holds the vault (OneDrive, Dropbox…), if any. */
  synced?: string | null;
}

/** What emptying the trash did; undoing `commit` brings it all back. */
export interface Emptied {
  removed: number;
  /** Files kept because history does not hold them as they are. */
  kept: string[];
  commit: string | null;
}

/** `.kasten/config.yaml`, as the core reads it. */
export interface VaultConfig {
  name: string;
  git: { remote: string | null; push_delay_seconds: number; push_interval_minutes: number };
  guardrails: Record<string, number>;
  ai: {
    providers: { name: string; kind: string; base_url: string; model: string }[];
    /** Search by meaning: the provider and model that make notes' vectors. */
    embeddings?: { provider: string; model: string } | null;
  };
  /** The template new journal days start from, by name; none means "journal". */
  journal_template?: string | null;
}

export interface Problem {
  kind: string;
  path: string | null;
  detail: string;
}

export interface VerifyReport {
  notes: number;
  boards: number;
  decks: number;
  gitObjects: number;
  problems: Problem[];
}

/** How connected a note is (Card Library). */
export interface NoteStats {
  path: string;
  /** Notes linking to it. */
  backlinks: number;
  /** Links it makes. */
  links: number;
  /** Boards showing it. */
  boards: number;
}

/** A property in a tag's schema, `tags/<name>.yaml`. */
export interface PropDef {
  key: string;
  /** text, number, select, multi_select, date, checkbox, url or relation. */
  type: string;
  options: string[];
}

export interface TagSchema {
  name: string;
  color: string | null;
  properties: PropDef[];
  /** Views as written: {name, type: table | kanban | list | calendar, ...}. */
  views: Record<string, unknown>[];
  path: string;
}

export type TagViewKind = "table" | "kanban" | "list" | "calendar" | "gallery";

/** How a view narrows its notes: `is`, `is_not`, `contains`, `empty`,
 * `not_empty`, `before` or `after` (dates) against `value`. */
export interface ViewFilter {
  key: string;
  op: "is" | "is_not" | "contains" | "empty" | "not_empty" | "before" | "after";
  value?: unknown;
}

/** A tag database view as saved in the tag's YAML. */
export interface TagView {
  name: string;
  type: TagViewKind;
  /** Kanban: the select property whose options are the columns. */
  group_by?: string;
  /** Calendar: the date property it places notes by. */
  date?: string;
  sort?: { key: string; dir: "asc" | "desc" }[];
  filter?: ViewFilter[];
  /** Table: the properties shown, in order. */
  columns?: string[];
  /** Keys other tools wrote stay as they were. */
  [key: string]: unknown;
}

// Sources and highlights: see source-types.ts.
export type { Highlight, HighlightColor, HighlightEdit, NewHighlight, PdfRect, SourceHighlights, SourceInfo, SourceOps } from "./source-types";
export type { ImportKind, ImportOps, ImportOptions, ImportSummary, Imported } from "./import-types";

// Find and replace across a page and its sub-pages: see replace-types.ts.
export type { Expected, FindSpec, MatchSample, NoteMatches, ReplaceOps, ReplaceRequest, Replaced } from "./replace-types";
export { REPLACE_LIMITS, replaceWasStale } from "./replace-types";

// The link graph: see graph-types.ts.
export type { GraphEdge, GraphKind, GraphNode, GraphOps, GraphScope, VaultGraph } from "./graph-types";

// Agents' proposals, sessions and marks: see agent-types.ts.
export type { AgentMark, AgentOp, ChangedFile, Proposal, SessionInfo, Undone } from "./agent-types";

// Slide decks: see deck-types.ts.
export type { DeckFile, DeckInfo, DeckSaved } from "./deck-types";

// Diagrams (a `.drawio` source and its `.drawio.svg` picture): see diagram-types.ts.
export type { DiagramFile, DiagramInfo, DiagramMoved, DiagramOps, DiagramPreview, DiagramSaved } from "./diagram-types";

// The gallery's pictures: see asset-types.ts.
export type { AddedAsset, AssetEdit, AssetInfo, AssetOps, AssetSourceName, AssetUsage, ClipRect, DeckUse, NewAsset, PdfClip, SlideUse, UsePlace } from "./asset-types";

// Whiteboards: see board-types.ts.
export type { BoardAdded, BoardApplied, BoardChange, BoardDrawing, BoardEdge, BoardEnd, BoardInfo, BoardNode, BoardSide, BoardSource, BoardView, LineStyle, ShapeKind, SourceBranch } from "./board-types";

/** What the core tells the window while it runs. */
export interface VaultEvents {
  /** Files changed outside Kasten (another app, an agent, a sync tool). */
  changed(paths: string[]): void;
  /** The clock committed edits or pushed a backup. */
  committed(): void;
  error(message: string): void;
}

/** Every vault operation the app uses. Each maps to one kasten-core op. */
export interface VaultClient extends SourceOps, ImportOps, AssetOps, ReplaceOps, GraphOps, DiagramOps {
  /** `vault` for a folder on disk through the core, `preview` in a plain browser. */
  readonly kind: "vault" | "preview";
  /** Where the notes live, for the status bar. */
  readonly label: string;
  /** Where a preview keeps its notes: this browser's storage, or memory
   * only, until the page reloads (`?samples=dev`, `?big=`). */
  readonly kept?: "browser" | "memory";
  list(): Promise<NoteMeta[]>;
  /** The notes at these paths that exist, in the order asked. */
  notesAt(paths: string[]): Promise<NoteMeta[]>;
  /** Starter templates the vault lacks, by name (shipped after it was made). */
  missingTemplates(): Promise<string[]>;
  /** Adds them in one commit, never touching the vault's own; their paths. */
  addStarterTemplates(): Promise<string[]>;
  /** The tour of the app as a page, made the first time it is asked for; its path. */
  addTour(): Promise<string>;
  read(path: string): Promise<NoteFile>;
  create(note: NewNote): Promise<NoteFile>;
  saveBody(path: string, body: string, baseHash: string): Promise<Saved>;
  /** The starter kits on offer. */
  kits(): Promise<KitInfo[]>;
  /** Adds a starter kit in one change that Undo takes back. */
  addKit(id: string): Promise<AddedKit>;
  /** Saves a page as a new template called `name`. */
  saveAsTemplate(path: string, name: string): Promise<NoteFile>;
  /** The page header's keys, and a page's own layout (`font`, `width`, `text`). */
  setMeta(path: string, key: MetaField, value: string | null): Promise<NoteFile>;
  /** New title; the file follows it and every link to the note is updated. */
  rename(path: string, title: string): Promise<Renamed>;
  /** Moves a note and its sub-pages into a project folder, or with null to the library. */
  move(path: string, project: string | null): Promise<Placed>;
  /** Moves a note back into the inbox, as Undo of filing it asks. */
  moveToInbox(path: string): Promise<Placed>;
  /** Puts the page at `path` inside the page at `parent`, moving it to that
   * page's project or the library; with null, makes it a page of its own. */
  nest(path: string, parent: string | null): Promise<Placed>;
  /** Makes a card a page or a page a card, filed where that kind lives. */
  convert(path: string, kind: "card" | "page"): Promise<Placed>;
  /** Copies a page beside itself as "<title> (copy)" with a new id. */
  duplicate(path: string): Promise<NoteFile>;
  trash(path: string): Promise<string>;
  journal(date: string): Promise<NoteFile>;
  applyTemplate(path: string, template: string, date: string): Promise<NoteFile>;
  search(query: string, limit?: number): Promise<Hit[]>;
  /** Notes whose links go to the note at `path`. */
  backlinks(path: string): Promise<Backlink[]>;
  listTrash(): Promise<Trashed[]>;
  /** The text of something in the trash, to look at before restoring it. */
  readTrashed(trashed: string): Promise<string>;
  /** Empties the trash into history (desktop only: the preview keeps none). */
  emptyTrash?(): Promise<Emptied>;
  /** Puts a trashed note back. */
  restore(trashed: string): Promise<NoteFile>;
  /** Puts a trashed board back; resolves to where it went. */
  restoreBoard(trashed: string): Promise<string>;
  /** Puts a trashed deck back; resolves to where it went. */
  restoreDeck(trashed: string): Promise<string>;
  /** A quick note as a card, in the inbox or in `project`'s cards (its
   * folder under `projects/`); its first line is its title. */
  capture(markdown: string, tags: string[], project?: string | null): Promise<NoteFile>;
  /** Notes naming `title` without linking it. */
  mentions(title: string, path: string): Promise<Backlink[]>;
  /** Notes that link each day from `from` to `to`, outside to-dos: the calendar's mentions. */
  dayMentions(from: string, to: string): Promise<DayMention[]>;
  /** Notes about the same things as the note at `path`, linked or not, the most alike first. */
  related(path: string, limit?: number): Promise<RelatedNote[]>;
  tasks(): Promise<TaskRow[]>;
  /** Commits newest first; with a path, those that changed that note. */
  history(path: string | null, limit?: number): Promise<CommitInfo[]>;
  /** A note's text at a commit. */
  version(rev: string, path: string): Promise<string | null>;
  restoreVersion(path: string, rev: string): Promise<NoteFile>;
  /** Puts every file back as it was at `rev`, as one commit; files made
   * since go to the trash. Undo takes it back with `undoCommit`. */
  restoreVault(rev: string): Promise<VaultRestore>;
  /** Commits the typing done so far (on leaving a page). */
  commitEdits(): Promise<string | null>;
  status(): Promise<VaultStatus>;
  startHistory(): Promise<void>;
  pushNow(): Promise<BackupStatus>;
  getConfig(): Promise<VaultConfig>;
  setConfig(config: VaultConfig): Promise<void>;
  verify(): Promise<VerifyReport>;
  noteStats(): Promise<NoteStats[]>;
  tagSchemas(): Promise<TagSchema[]>;
  /** Replaces a tag's views in its YAML, keeping the rest of the file. */
  setTagViews(tag: string, views: TagView[]): Promise<TagSchema>;
  /** Replaces a tag's properties in its YAML the same way. */
  setTagProperties(tag: string, properties: PropDef[]): Promise<TagSchema>;
  /** Sets properties (null removes one), checked against the tags' schemas. */
  updateProps(path: string, props: Record<string, unknown>): Promise<NoteFile>;
  setTags(path: string, add: string[], remove: string[]): Promise<NoteFile>;
  replaceSection(path: string, heading: string, markdown: string): Promise<NoteFile>;
  /** Adds Markdown at the end of the note, or of the section under `heading`. */
  append(path: string, markdown: string, heading?: string | null): Promise<NoteFile>;
  /** Keeps a pasted or dropped file in `assets/`; resolves to its vault
   * path. The same bytes again reuse the file already there. */
  saveAsset(name: string, bytes: Uint8Array): Promise<string>;
  /** The bytes of a picture kept in `assets/`, by its vault path (a slide's picture, packed into an export). */
  readAsset(path: string): Promise<Uint8Array>;
  /** Hands a finished file (an exported deck) to the person. The desktop app saves it in their Downloads folder under a free name, never over another file, and resolves to the path it went to; the browser preview downloads it and resolves to the name. */
  saveDownload(name: string, bytes: Uint8Array, type: string): Promise<string>;
  boards(): Promise<BoardInfo[]>;
  board(path: string): Promise<BoardView>;
  createBoard(title: string, project: string | null): Promise<string>;
  /** `layout`: grid or cluster_by_tag; `positions` places each note instead. */
  addToBoard(board: string, notes: string[], layout?: "grid" | "cluster_by_tag", positions?: [number, number][]): Promise<BoardAdded>;
  addSticky(board: string, text: string, at?: [number, number]): Promise<string>;
  /** Nodes by id, file path or title. */
  connect(board: string, from: string, to: string, label?: string): Promise<string>;
  group(board: string, nodes: string[], label: string): Promise<string>;
  /** A person's edits on a board, applied whole or not at all. */
  boardApply(board: string, changes: BoardChange[]): Promise<BoardApplied>;
  /** The boards with a card for this note. */
  boardsWith(path: string): Promise<BoardInfo[]>;
  /** Every slide deck, by title. */
  decks(): Promise<DeckInfo[]>;
  /** A deck's text with the hash a save brings back. */
  deck(path: string): Promise<DeckFile>;
  /** The bibliography the citations of decks are looked up in: the text of every `.bib` file in the vault, one after another. Empty when there are none. */
  references(): Promise<string>;
  /** Creates a deck holding `text` (the Slides engine makes it) in the project or the library; resolves to its path. */
  createDeck(title: string, project: string | null, text: string): Promise<string>;
  /** Saves a deck if the file is still the one read (`baseHash`); if it changed, the text goes to a copy beside it. */
  saveDeck(path: string, text: string, baseHash: string): Promise<DeckSaved>;
  /** The slide templates kept in the vault (`templates/slides/`), by title. They are decks to read and save like any (`deck`, `saveDeck`, `trash`), and are not among `decks()`. */
  deckTemplates(): Promise<DeckInfo[]>;
  /** Saves a deck's look as a template (the Slides engine makes `text`); resolves to its path. Only a person does this: an assistant cannot write a template. */
  createDeckTemplate(title: string, text: string): Promise<string>;
  proposals(): Promise<Proposal[]>;
  acceptProposal(id: string): Promise<unknown>;
  rejectProposal(id: string): Promise<void>;
  sessions(limit?: number): Promise<SessionInfo[]>;
  undoSession(session: string): Promise<Undone>;
  /** Fetches a web page and keeps its article as an inbox card (the desktop app only). */
  clipUrl(url: string): Promise<NoteFile>;
  trustSession(session: string, minutes?: number): Promise<void>;
  /** The files a commit changed, before and after. */
  commitChanges(rev: string): Promise<ChangedFile[]>;
  /** The lines of a note an agent wrote that you have not edited or accepted. */
  agentMarks(path: string): Promise<AgentMark[]>;
  /** Keeps the agent's writing in a note as it stands, so its marks go. */
  acceptAgentMarks(path: string): Promise<void>;
  /** Which of these notes have agent marks, for badges on cards and rows. */
  agentMarked(paths: string[]): Promise<string[]>;
  /** Listens for the core's events; returns how to stop. */
  watch?(events: VaultEvents): () => void;
}

/** The frontmatter keys `setMeta` changes. */
export type MetaField = "title" | "icon" | "cover" | "font" | "width" | "text" | "locked" | "opens" | "layout";

/** A starter kit the app offers (kasten-core `KitInfo`). */
export interface KitInfo {
  id: string;
  /** An emoji, as its home page has. */
  icon: string;
  name: string;
  summary: string;
  /** The page that explains it, opened once it is added. */
  home: string;
  recommended: boolean;
  /** Where each of its files goes in the vault. */
  files: string[];
}

/** What adding a starter kit did (kasten-core `AddedKit`). */
export interface AddedKit {
  home: string;
  written: string[];
  /** The vault's own files at the kit's paths, left as they were. */
  kept: string[];
  /** Its commit, for Undo; none in the browser preview. */
  commit: string | null;
}
