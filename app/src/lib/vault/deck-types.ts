// Slide decks as the vault holds them. A deck's text belongs to the Slides
// editor's engine, which reads and writes it; the vault only stores it.

/** A deck in lists. */
export interface DeckInfo {
  path: string;
  title: string;
  project: string | null;
  slides: number;
  modified: number;
  size: number;
  /** Why the deck can't be read, when it can't: it is still listed. */
  problem: string | null;
}

/** A deck as it is on disk, with the hash a save brings back. */
export interface DeckFile {
  path: string;
  text: string;
  hash: string;
  modified: number;
}

/** One deck of a save of several: the text it is to hold, and the hash of the file as it was when that text was worked out. */
export interface DeckEdit {
  path: string;
  baseHash: string;
  text: string;
}

/** Several decks to save together, with the one line that says why in the history. */
export interface SaveDecksRequest {
  message: string;
  edits: DeckEdit[];
}

/** What saving several decks did. */
export interface DecksSaved {
  /** The commit it made: Undo takes it back whole (`undoCommit`). Null in the browser preview, and when no deck changed. */
  commit: string | null;
  /** The decks that were written; one that already held the text it was given is not among them. */
  paths: string[];
}

/** What the core's refusal says when a deck differs from the one that was looked at. */
const STALE = "changed since you looked";

/** Whether a failed save of several decks was refused because a deck changed since it was looked at: nothing was written, and the person should look again. */
export function saveDecksWasStale(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes(STALE);
}

/** What saving a deck did. */
export type DeckSaved =
  | { status: "written"; deck: DeckFile }
  | { status: "unchanged"; deck: DeckFile }
  /** The file changed since it was read: the text went to `copy` and `deck` is the file as it is. */
  | { status: "conflict"; copy: string; deck: DeckFile };
