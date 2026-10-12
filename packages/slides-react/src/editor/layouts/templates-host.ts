// What a host gives the editor so a deck's look can be kept and used again: the templates it holds. Kasten keeps them as plain
// `.deck` files in the vault; a host without any (the standalone page) leaves `templates` out, and the editor offers no templates.

export interface TemplateInfo {
  /** What the host calls it: a vault path in Kasten. Handed back to `read`. */
  id: string;
  /** What people call it. */
  title: string;
  /** How many slides it holds (its examples). */
  slides: number;
}

export interface TemplatesHost {
  /** The templates the host keeps, by title. */
  list(): Promise<TemplateInfo[]>;
  /** A template as the text of a `.deck` file, to start a deck from or to take the look of. */
  read(id: string): Promise<string>;
  /** Keeps the text of a deck as a template called `title`; resolves to its id. */
  save(title: string, text: string): Promise<string>;
}
