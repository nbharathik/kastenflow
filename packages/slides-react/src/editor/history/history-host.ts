// What the editor needs of a host that keeps the saved versions of a deck.

/** One saved version of the deck's file. */
export interface DeckVersion {
  /** Names the version in the host's own words (a commit in Kasten). */
  id: string;
  /** When it was saved, in milliseconds since 1970. */
  time: number;
  /** Who saved it: a person, or an assistant by its name. */
  author: string;
  /** What the change was, in a few words. */
  summary: string;
}

export interface DeckHistoryHost {
  /** The saved versions of this deck, newest first. */
  versions(): Promise<DeckVersion[]>;
  /** The text of the deck's file at a version; undefined when the host no longer has it. */
  read(id: string): Promise<string | undefined>;
}
