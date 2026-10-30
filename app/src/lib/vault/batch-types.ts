// A batch the person runs from the window: many changes, all made or none, as
// one commit that one Undo takes back (`undoCommit`). The shapes of the window's
// commands in app/src-tauri/src/commands/batch.rs and kasten-core's
// `batch_as_person`. It is for table bulk actions, a pasted block of cells and
// "Turn into database"; agents have their own `batch` tool.

import type { DraftRule } from "./draft-rule";

/** The most changes one batch holds, and the most text it sends. */
export const BATCH_LIMITS = { changes: 100, bytes: 1024 * 1024 } as const;

/** One change: kasten-core's agent op as JSON (`{ kind: "create_note", … }`). */
export type BatchChange = { kind: string } & Record<string, unknown>;

/** A later change names the note an earlier one makes (the change's number, from 0). */
export interface BatchRef {
  $ref: number;
}

/** What one change answered: a made or changed note is `{ path, id, title }`; a tag schema `{ path }`. */
export interface BatchAnswer {
  path?: string;
  id?: string | null;
  title?: string;
  [field: string]: unknown;
}

/** What a batch did. */
export interface BatchRun {
  changes: number;
  /** One answer per change, in order. A note a later change moved shows where it ended up. */
  results: BatchAnswer[];
  /** The one commit; `undoCommit` takes it back whole. Null when nothing changed, and in the browser preview. */
  commit: string | null;
}

/** A block of a page, as a page edit names it. */
export interface PageBlock {
  /** `b1`, `b2`, …: its place in this read. */
  id: string;
  kind: "paragraph" | "heading" | "list" | "todo" | "table" | "code" | "quote" | "callout" | "toggle" | "columns" | "column" | "embed" | "math" | "divider" | "html";
  depth: number;
  heading_path: string[];
  /** The block's text, cut to 400 characters. */
  text: string;
  /** Changes when the block's bytes do; a page edit that names a block with another hash is refused. */
  hash: string;
  /** A table's size; the rows count its header. */
  table?: { rows: number; columns: number };
}

export interface PageBlocks {
  path: string;
  title: string;
  hash: string;
  total: number;
  truncated: boolean;
  blocks: PageBlock[];
}

export interface BatchOps {
  /**
   * Makes the changes together or not at all: one commit, one Undo. Refused
   * whole when any change is (one plain sentence naming it), and nothing is
   * written. Up to 100 changes and 1 MB of text. Save open pages first.
   * `reason` is the commit's summary.
   */
  runBatch(changes: BatchChange[], reason?: string): Promise<BatchRun>;
  /** A saved page's blocks with their ids and hashes, for a change that edits the page in a batch. */
  pageBlocks(path: string): Promise<PageBlocks>;
  /** Where the schema of the new tag `tag` will be written (`tags/reading-list.yaml`), so a page can embed the database in the same batch. Refused for a name with no letters or digits. */
  newTagFile(tag: string): Promise<string>;
}

/** What a call about a draft does, for each call of `BatchOps`. */
export const BATCH_RULES = {
  runBatch: "pass",
  pageBlocks: "pass",
  newTagFile: "pass",
} as const satisfies Record<keyof BatchOps, DraftRule>;
