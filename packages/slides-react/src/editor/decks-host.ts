// What a host gives the editor to look at the other decks it keeps: today, to bring layouts in from one of them. Kasten lists the `.deck`
// files of the vault; a host without any (the standalone page) leaves `decks` out and the editor offers no import of layouts.

export interface DeckInfo {
  /** What the host calls it: a vault path in Kasten. Handed back to `read`. */
  id: string;
  /** What people call it. */
  title: string;
  /** How many slides it holds. */
  slides: number;
}

export interface DecksHost {
  /** The decks the host keeps, by title. The deck being edited may be among them; the dialog leaves it out. */
  list(): Promise<DeckInfo[]>;
  /** A deck as the text of a `.deck` file. */
  read(id: string): Promise<string>;
}
