// References: the vault's bibliography, the entries a page or a deck cites by
// key (the shapes of kasten-core's bibliography and citation-rename ops, serde
// camelCase) and the calls the app makes.
//
// The vault has one managed file, `sources/references.bib`; every other `.bib`
// file is read only ("external"): `adoptBib` makes a managed copy of its works.
// An edit names the `hash` of the managed file it started from (`baseHash`) and
// is refused, with a sentence, when the file changed since. Edits change only
// the bytes they mean to: comments, `@string` macros, unknown fields and
// formatting stay as written. Every call that writes is one commit that
// `undoCommit` takes back. `references()` on the client is still the text of
// every `.bib` file, managed one first, for decks.

import type { DraftRule } from "./draft-rule";

/** Where the managed bibliography is. It may not exist yet: the first added reference makes it. */
export const MANAGED_BIB = "sources/references.bib";

/** The entry types the form offers, in this order. The file may hold others. */
export const ENTRY_TYPES = ["article", "inproceedings", "book", "incollection", "phdthesis", "mastersthesis", "techreport", "misc", "online", "unpublished"] as const;

/** The order new fields are written in; fields not named here follow in alphabetical order. */
export const FIELD_ORDER = ["author", "editor", "title", "booktitle", "journal", "publisher", "school", "institution", "volume", "number", "pages", "year", "month", "doi", "eprint", "archiveprefix", "url", "note"] as const;

/** One entry of a `.bib` file. */
export interface BibEntry {
  key: string;
  /** The entry type in lower case: `article`, `inproceedings`... */
  type: string;
  /** Fields by lower-case name, as written: outer braces or quotes off, `@string` macros put in, LaTeX left in. */
  fields: Record<string, string>;
}

/** One `.bib` file of the vault. */
export interface BibFile {
  path: string;
  /** True for `sources/references.bib` alone. */
  managed: boolean;
  /** False for a managed file that has not been made yet. */
  exists: boolean;
  /** Hash of the file's text: the `baseHash` of an edit. */
  hash: string;
  bytes: number;
  /** Why the file is not read (too big, not UTF-8 text), when it is not. */
  problem: string | null;
  entries: BibEntry[];
}

/** What makes two entries the same work. */
export type MatchKind = "key" | "doi" | "arxiv";

export interface EntryRef {
  file: string;
  key: string;
}

/** Entries that look like one work: the same key, the same DOI (normalised) or the same arXiv identifier. */
export interface Duplicate {
  by: MatchKind;
  /** The key, DOI or arXiv identifier they share. */
  value: string;
  entries: EntryRef[];
}

export interface Bibliography {
  managed: BibFile;
  /** The other `.bib` files, by path; read only. */
  external: BibFile[];
  duplicates: Duplicate[];
}

/** A reference to add to the managed file. */
export interface NewReference {
  type: string;
  /** Letters, digits and `_ - : . / + ? < > ~ & $`, starting and ending with a letter, digit or `_`; at most 128 characters. */
  key: string;
  /** Lower-case names. Braces in a value must balance. Empty values are left out. */
  fields: Record<string, string>;
  /** Add it although the key, the DOI or the arXiv identifier is in the bibliography already. */
  allowDuplicate?: boolean;
}

/** An entry in the bibliography that a new reference would repeat. */
export interface ReferenceMatch {
  by: MatchKind;
  value: string;
  /** The file it is in. */
  file: string;
  key: string;
}

/** What an edit of the managed file did. */
export interface ReferenceSaved {
  key: string;
  /** The managed file's hash now: the `baseHash` of the next edit. */
  hash: string;
  /** The one commit, for Undo; none in a vault without history and in the browser preview. */
  commit: string | null;
}

export interface SkippedKey {
  key: string;
  /** In a sentence. */
  why: string;
}

/** What making a managed copy of an external file did. */
export interface Adopted {
  /** Keys copied, in the order of the file. */
  added: string[];
  skipped: SkippedKey[];
  hash: string;
  commit: string | null;
}

/** What a key is made from. */
export interface KeyHints {
  /** Authors as BibTeX writes them ("Vaswani, Ashish and Shazeer, Noam") or as people say them; the first author's family name is used. */
  author?: string;
  year?: string;
  title?: string;
}

/** A page that cites a key. */
export interface CitingPage {
  path: string;
  title: string;
  /** How many times it cites the key. */
  count: number;
}

/** A deck that cites a key. */
export interface CitingDeck {
  path: string;
  title: string;
  /** Citations on its slides. */
  count: number;
  /** Citations in its master or layouts, which a rename leaves as they are. */
  inLayouts: number;
}

/** Where a key is cited. */
export interface KeyUses {
  key: string;
  pages: CitingPage[];
  decks: CitingDeck[];
  /** Pictures whose sidecar names the key as their `citationKey`. */
  assets: string[];
}

export interface PlannedPage extends CitingPage {
  hash: string;
}

export interface PlannedDeck extends CitingDeck {
  hash: string;
}

/** What renaming a key would change, worked out without writing anything. */
export interface KeyRenamePlan {
  from: string;
  to: string;
  /** The managed file the entry is in. */
  file: string;
  /** Hash of the managed file: the `bibHash` of the rename. */
  bibHash: string;
  pages: PlannedPage[];
  decks: PlannedDeck[];
  assets: string[];
}

/** What a rename did. */
export interface KeyRenamed {
  from: string;
  to: string;
  pages: number;
  decks: number;
  assets: number;
  /** Citations in decks' masters or layouts, which were not renamed. */
  layouts: number;
  commit: string | null;
}

export interface ReferenceOps {
  /** The managed file, the external files and the duplicates among them. */
  bibliography(): Promise<Bibliography>;
  /** The entries a reference would repeat (by key, DOI or arXiv identifier), the managed file's first. Writes nothing. */
  checkReference(reference: NewReference): Promise<ReferenceMatch[]>;
  /** A key for a work, `vaswani2017attention`: the first author's family name, the year, the first word of the title that says something; lower-case ASCII, with `-2`, `-3`... when taken. Writes nothing. */
  suggestKey(hints: KeyHints): Promise<string>;
  /** Adds an entry at the end of the managed file in house style (two-space fields, a trailing comma), making the file if needed. Refused when the key, DOI or arXiv identifier is there already, unless `allowDuplicate`. */
  addReference(reference: NewReference, baseHash: string): Promise<ReferenceSaved>;
  /** Sets the fields named (a value of `null` removes the field), changing only those bytes: a value in place, a new field as a new line after the last one. */
  updateReference(key: string, fields: Record<string, string | null>, baseHash: string): Promise<ReferenceSaved>;
  /** Replaces an entry's text with `text`, which must be one complete entry with the same key. */
  replaceReference(key: string, text: string, baseHash: string): Promise<ReferenceSaved>;
  /** Copies entries of an external `.bib` file (all, or `keys`) into the managed file, as written. The external file is not changed. Keys the managed file has are skipped. */
  adoptBib(path: string, keys: string[] | null, baseHash: string): Promise<Adopted>;
  /** The pages, decks and pictures that cite `key`. */
  referenceUses(key: string): Promise<KeyUses>;
  /** What renaming `from` to `to` would change. Refused (with a sentence) when `from` is not in the managed file, or `to` is not a key or is one already. */
  planKeyRename(from: string, to: string): Promise<KeyRenamePlan>;
  /** Renames the key in the managed file, in the pages that cite it (`[@key]`), in the decks' citations and in pictures' sidecars: one commit. `bibHash` is the plan's. */
  renameCitationKey(from: string, to: string, bibHash: string): Promise<KeyRenamed>;
}

/** What a call about a draft does, for each call of `ReferenceOps`. */
export const REFERENCE_RULES = {
  bibliography: "pass",
  checkReference: "pass",
  suggestKey: "pass",
  addReference: "pass",
  updateReference: "pass",
  replaceReference: "pass",
  adoptBib: "pass",
  referenceUses: "pass",
  planKeyRename: "pass",
  renameCitationKey: "pass",
} as const satisfies Record<keyof ReferenceOps, DraftRule>;
