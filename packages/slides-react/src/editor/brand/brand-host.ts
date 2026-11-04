// What a host gives the editor so a brand kit can be kept for the vault or a project: Kasten keeps it as a small file in the vault.
// A host without one (the standalone page) leaves `brand` out, and the editor offers no brand kit. A deck never needs the kit to open.

/** Whose kit it is: every deck of the vault, or the decks of the project the deck is in. */
export type BrandScope = "vault" | "project";

export interface BrandHost {
  /** The project the deck is in, when it is in one: the dialog then offers a kit for that project besides the vault's. */
  project?: string | null;
  /** The kit decks here start from, as the text of its file (the project's own, else the vault's), and whose it is; null when there is none. */
  read(): Promise<{ text: string; scope: BrandScope } | null>;
  /** Keeps `text` as the kit of the vault or of the project; the old text of a kit that is replaced stays in the host's history. */
  save(text: string, scope: BrandScope): Promise<void>;
}
