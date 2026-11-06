// What a host gives the editor so layouts can be kept for every deck: the layout library. Kasten keeps one small file for each in the
// vault; a host without a library (the standalone page) leaves `layoutLibrary` out, and the editor offers no "My layouts" and no choice
// of where to save a layout. A deck never needs the library to open: using a library layout copies it into the deck.

/** One layout of the library in a list. */
export interface LibraryEntry {
  /** The entry's own id, which a copy in a deck remembers it by. Handed back to `read` and `remove`. */
  id: string;
  /** What people call it. */
  label: string;
  /** How many slots it has. */
  slots: number;
  /** When it last changed, in milliseconds. */
  modified?: number;
}

export interface LayoutLibraryHost {
  /** The layouts of the library, by name. */
  list(): Promise<LibraryEntry[]>;
  /** One entry as the text of its file (the editor wrote it: see `library.ts`). Rejects when it is gone. */
  read(id: string): Promise<string>;
  /** Keeps `text` in the library; the entry with the same id is replaced by it, a new id makes a new entry. */
  save(text: string): Promise<void>;
  /** Takes an entry out of the library. The host keeps its file somewhere a person can get it back (Kasten: the trash). Decks that hold a copy are not touched. */
  remove?(id: string): Promise<void>;
  /** Calls `onChange` when the library changed (saved here or somewhere else); returns how to stop. */
  watch?(onChange: () => void): () => void;
}
