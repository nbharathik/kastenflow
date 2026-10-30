// The vault as the frontend sees it: the shapes kasten-core's ops return
// (serde, camelCase) and the client every view talks to. The shapes live in
// the `*-types.ts` files beside this one and are re-exported from here.

import type { AgentModeOps } from "./agent-mode-types";
import type { BatchOps } from "./batch-types";
import type { AgentMark, ChangedFile, Digest, Proposal, SessionInfo, Undone } from "./agent-types";
import type { AnnotationOps } from "./annotation-types";
import type { AssetOps } from "./asset-types";
import type { BoardAdded, BoardApplied, BoardChange, BoardInfo, BoardView } from "./board-types";
import type { BundleOps } from "./bundle-types";
import type { CollectionOps } from "./collection-types";
import type { DeckFile, DeckInfo, DeckSaved, DecksSaved, SaveDecksRequest } from "./deck-types";
import type { DiagramOps } from "./diagram-types";
import type { GraphOps } from "./graph-types";
import type { HealthOps } from "./health-types";
import type { ImportOps } from "./import-types";
import type {
  Backlink,
  DayMention,
  Hit,
  MetaField,
  NewNote,
  NoteFile,
  NoteMeta,
  Placed,
  RelatedNote,
  Renamed,
  Saved,
  TaskRow,
  Trashed,
} from "./note-types";
import type { ProjectOps } from "./project-types";
import type { ReferenceOps } from "./reference-types";
import type { ReplaceOps } from "./replace-types";
import type { Revision, RevisionOps } from "./revision-types";
import type { SourceOps } from "./source-types";
import type { BackupStatus, CommitInfo, Emptied, VaultConfig, VaultRestore, VaultStatus, VerifyReport } from "./status-types";
import type { AddedKit, FormulaFill, FormulaIssue, KitInfo, NoteStats, PropDef, TagSchema, TagView } from "./tag-types";

// Notes: see note-types.ts.
export type { Backlink, DayMention, Hit, MetaField, NewNote, NoteFile, NoteKind, NoteMeta, Placed, RelatedNote, Renamed, Saved, TaskRow, Trashed } from "./note-types";

// History, backup, settings and the check: see status-types.ts.
export type { BackupFileStatus, BackupState, BackupStatus, CommitInfo, Emptied, Problem, VaultConfig, VaultRestore, VaultStatus, VerifyReport } from "./status-types";

// Tags, their schemas and views, starter kits: see tag-types.ts.
export type { AddedKit, FormulaFill, FormulaIssue, KitInfo, NoteStats, PropDef, TagSchema, TagView, TagViewKind, ViewFilter } from "./tag-types";

// Sources and highlights: see source-types.ts.
export type { Highlight, HighlightColor, HighlightEdit, NewHighlight, PdfRect, SourceHighlights, SourceInfo, SourceOps } from "./source-types";
export type { ImportConflict, ImportConflictKind, ImportKind, ImportOps, ImportOptions, ImportSummary, Imported } from "./import-types";

// Find and replace across a page and its sub-pages: see replace-types.ts.
export type { Expected, FindSpec, MatchSample, NoteMatches, ReplaceOps, ReplaceRequest, Replaced } from "./replace-types";
export { REPLACE_LIMITS, replaceWasStale } from "./replace-types";

// The link graph: see graph-types.ts.
export type { GraphEdge, GraphKind, GraphNode, GraphOps, GraphScope, VaultGraph } from "./graph-types";

// Agents' proposals, sessions and marks: see agent-types.ts. How much they may
// do and where the vault can be put back to: see agent-mode-types.ts.
export type { AgentMark, AgentOp, ChangedFile, Digest, DigestSession, Proposal, SessionInfo, Undone } from "./agent-types";
export type { AgentMode, AgentModeOps, AgentPolicy, AgentPolicyView, Checkpoint } from "./agent-mode-types";
export { AGENT_MODES } from "./agent-mode-types";

// A batch the person runs, as one commit and one Undo: see batch-types.ts.
export type { BatchAnswer, BatchChange, BatchOps, BatchRef, BatchRun, PageBlock, PageBlocks } from "./batch-types";
export { BATCH_LIMITS } from "./batch-types";

// Slide decks: see deck-types.ts.
export type { DeckEdit, DeckFile, DeckInfo, DeckSaved, DecksSaved, SaveDecksRequest } from "./deck-types";
export { saveDecksWasStale } from "./deck-types";

// Diagrams (a `.drawio` source and its `.drawio.svg` picture): see diagram-types.ts.
export type { DiagramFile, DiagramInfo, DiagramMoved, DiagramOps, DiagramPreview, DiagramSaved } from "./diagram-types";

// The gallery's pictures: see asset-types.ts.
export type { AddedAsset, AssetEdit, AssetInfo, AssetOps, AssetSourceName, AssetUsage, ClipRect, DeckUse, NewAsset, PdfClip, SlideUse, UsePlace } from "./asset-types";

// Whiteboards: see board-types.ts.
export type { BoardAdded, BoardApplied, BoardChange, BoardDrawing, BoardEdge, BoardEnd, BoardInfo, BoardNode, BoardSide, BoardSource, BoardView, LineStyle, ShapeKind, SourceBranch } from "./board-types";

// Projects, saved collections, annotations, references, bundles, the health
// report and the vault's revision: see project-, collection-, annotation-,
// reference-, bundle-, health- and revision-types.ts.
export type { AppliedSetup, NextAction, ProjectHealth, ProjectOps, ProjectStateChange, ProjectStatus, ProjectSummary, SavedSetup, SetupGone, SetupInfo, SetupPage, SetupPlan, SetupSource, SetupTarget, TaskCounts } from "./project-types";
export type { CollectionOps } from "./collection-types";
export type { AnnotationOps, CommentAnchor, CommentResolved, NewComment, NewTextHighlight, PageComment, TextAnchor, TextHighlight, TextHighlightColor, TextHighlightEdit } from "./annotation-types";
export type { Adopted, BibEntry, BibFile, Bibliography, CitingDeck, CitingPage, Duplicate, EntryRef, KeyHints, KeyRenamePlan, KeyRenamed, KeyUses, MatchKind, NewReference, PlannedDeck, PlannedPage, ReferenceMatch, ReferenceOps, ReferenceSaved, SkippedKey } from "./reference-types";
export { ENTRY_TYPES, FIELD_ORDER, MANAGED_BIB } from "./reference-types";
export type { BundleExported, BundleFile, BundleFileKind, BundleOps, BundlePlan, BundleProject } from "./bundle-types";
export { BUNDLE_MANIFEST } from "./bundle-types";
export type { Health, HealthCounts, HealthOps, LastCheck, MeaningHealth } from "./health-types";
export type { Revision, RevisionArea, RevisionOps } from "./revision-types";

/** What the core tells the window while it runs. */
export interface VaultEvents {
  /** Files changed outside Kasten (another app, an agent, a sync tool). */
  changed(paths: string[]): void;
  /** The clock committed edits or pushed a backup. */
  committed(): void;
  error(message: string): void;
  /** The vault's change counters moved (after any change, whoever made it). */
  revised?(revision: Revision): void;
}

/** Every vault operation the app uses. Each maps to one kasten-core op. */
export interface VaultClient
  extends SourceOps,
    ImportOps,
    AssetOps,
    ReplaceOps,
    GraphOps,
    DiagramOps,
    ProjectOps,
    CollectionOps,
    AnnotationOps,
    ReferenceOps,
    BundleOps,
    HealthOps,
    AgentModeOps,
    BatchOps,
    RevisionOps {
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
  /** Stores the order the page at `parent` shows its sub-pages in (their ids,
   * first to last); sub-pages left out follow alphabetically. */
  reorderChildren(parent: string, ids: string[]): Promise<NoteFile>;
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
  /** The calculated cells of a tag's rows as of `today` (YYYY-MM-DD, this window's day). */
  tagFormulas(tag: string, today: string): Promise<FormulaFill>;
  /** What is wrong with one formula as typed, or null; `properties` are the tag's, as being edited. */
  checkFormula(formula: string, key: string, properties: PropDef[]): Promise<FormulaIssue | null>;
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
  /** Saves several decks together, all or none, as one change that `undoCommit` takes back whole. Every deck must be as it was when its new text was worked out (`baseHash`), or nothing is written. Save open decks first. */
  saveDecks(request: SaveDecksRequest): Promise<DecksSaved>;
  /** The slide templates kept in the vault (`templates/slides/`), by title. They are decks to read and save like any (`deck`, `saveDeck`, `trash`), and are not among `decks()`. */
  deckTemplates(): Promise<DeckInfo[]>;
  /** Saves a deck's look as a template (the Slides engine makes `text`); resolves to its path. Only a person does this: an assistant cannot write a template. */
  createDeckTemplate(title: string, text: string): Promise<string>;
  proposals(): Promise<Proposal[]>;
  acceptProposal(id: string): Promise<unknown>;
  /** Accepts a change to a page's text with only the hunks the person kept: `body` is the text they put together. Merged with edits made since, and refused where those overlap. */
  acceptProposalHunks(id: string, body: string): Promise<unknown>;
  rejectProposal(id: string): Promise<void>;
  sessions(limit?: number): Promise<SessionInfo[]>;
  /** What agents did since `since` (milliseconds since the Unix epoch), session by session; your own edits are not in it. */
  activityDigest(since: number): Promise<Digest>;
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
