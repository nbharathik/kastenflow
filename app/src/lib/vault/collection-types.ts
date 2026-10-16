// Saved collections: a search kept under a name (`views/<name>.yaml`; the
// shapes of kasten-core's collections ops, serde camelCase) and the calls the
// app makes. The same file also holds the two calls about a page that is
// already saved (the capture lookups), which share the vault's index.

import type { DraftRule } from "./draft-rule";
import type { NoteFile, NoteMeta } from "./note-types";
import type { TagViewKind, ViewFilter } from "./tag-types";

/** The spans of days a collection can look at; the app turns one into a range of days when it runs the collection. */
export const WHEN_TOKENS = ["today", "yesterday", "this-week", "last-7-days", "last-30-days", "this-month", "last-month", "this-year", "next-7-days"] as const;
export type WhenToken = (typeof WHEN_TOKENS)[number];

/** The day fields a span can be about: when a note was last changed, made, or either. */
export const WHEN_FIELDS = ["updated", "created", "on"] as const;
export type WhenField = (typeof WHEN_FIELDS)[number];

/** `{updated: "last-30-days"}`. */
export type CollectionWhen = Partial<Record<WhenField, WhenToken>>;

export interface CollectionSort {
  key: string;
  dir?: "asc" | "desc";
}

/** How a collection is shown, as a tag database's view is. */
export interface CollectionDisplay {
  type?: TagViewKind;
  columns?: string[];
  limit?: number;
  [key: string]: unknown;
}

/** The longest query, in characters, and the most notes a collection shows. */
export const COLLECTION_LIMITS = { query: 2000, name: 100, shown: 5000 } as const;

/** A saved collection. */
export interface Collection {
  /** `views/<slug>.yaml`. */
  path: string;
  slug: string;
  name: string;
  icon: string | null;
  /** The search box's syntax: words, `#tag`, `project:`, `under:`... */
  query: string;
  when: CollectionWhen | null;
  filter: ViewFilter[];
  sort: CollectionSort[];
  display: CollectionDisplay | null;
  format: number;
  /** Hash of the file's text; an edit brings it back as its base. */
  hash: string;
  modified: number;
  /** Why the file cannot be used, when it cannot: unreadable, from a newer version, or holding something not allowed. */
  problem: string | null;
  /** Listed to be looked at, not edited. */
  readOnly: boolean;
}

/** Changes to a collection's keys. A key left out stays; `null` removes it. Everything else in the file stays as written. */
export interface CollectionEdits {
  icon?: string | null;
  query?: string | null;
  when?: CollectionWhen | null;
  filter?: ViewFilter[] | null;
  sort?: CollectionSort[] | null;
  display?: CollectionDisplay | null;
}

/** A note already kept from the same web page. */
export interface CapturedBefore {
  path: string;
  title: string;
  /** The day it was captured, `YYYY-MM-DD`, when the note says. */
  captured: string | null;
}

/** What clipping a page did: it was kept, or it was already saved and nothing was written. */
export type ClipOutcome = { kind: "saved"; note: NoteFile } | { kind: "existing"; existing: CapturedBefore[] };

/** What adding a tag to many pages did. */
export interface TagAdded {
  /** The tag, as written to the pages. */
  tag: string;
  /** The pages that carry it now and did not before. */
  changed: NoteMeta[];
  /** The paths that carried it already and were left alone. */
  already: string[];
  /** The one commit, for Undo; none when nothing changed, and in the browser preview. */
  commit: string | null;
}

/** The most pages one request names. */
export const MAX_TAGGED = 500;

export interface CollectionOps {
  /** Every saved collection, by name; one that cannot be used is listed with the reason. */
  collections(): Promise<Collection[]>;
  /** The collection at `path` (`views/<name>.yaml`). */
  collection(path: string): Promise<Collection>;
  /** Saves a new collection under `name`; the file name is its slug, numbered when taken. One commit that Undo takes back. */
  createCollection(name: string, edits?: CollectionEdits): Promise<Collection>;
  /** Changes keys of a collection if its file is still as `baseHash` says; the rest of the file is kept as written. */
  updateCollection(path: string, edits: CollectionEdits, baseHash: string): Promise<Collection>;
  /** Gives a collection another name; its file moves to match. */
  renameCollection(path: string, name: string, baseHash: string): Promise<Collection>;
  /** Moves a collection to the trash; resolves to where it went. */
  trashCollection(path: string): Promise<string>;
  /** Puts a trashed collection back, under a free name if its own is taken. */
  restoreCollection(trashed: string): Promise<Collection>;
  /** The notes already kept from the web page at `url` (http and https, `www.`, a fragment and tracking parameters make no difference), the first saved first. */
  capturedFrom(url: string): Promise<NoteMeta[]>;
  /** Clips the page at `url` to the Inbox (the desktop app only). A page already saved is not clipped again unless `again` is true, which keeps a snapshot that points back at the first card; the answer then names what is saved. */
  clipPage(url: string, again?: boolean): Promise<ClipOutcome>;
  /** Adds a tag to many pages as one change that Undo takes back whole (`undoCommit`): the pages stay where they are and only their tags change; a page that has the tag is left alone. */
  addTagToMany(paths: string[], tag: string): Promise<TagAdded>;
}

/** What a call about a draft does, for each call of `CollectionOps`. */
export const COLLECTION_RULES = {
  collections: "pass",
  collection: "pass",
  createCollection: "pass",
  updateCollection: "pass",
  renameCollection: "pass",
  trashCollection: "pass",
  restoreCollection: "pass",
  capturedFrom: "pass",
  clipPage: "pass",
  addTagToMany: "pass",
} as const satisfies Record<keyof CollectionOps, DraftRule>;
