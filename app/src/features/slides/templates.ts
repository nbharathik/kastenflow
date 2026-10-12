// The slide templates a person keeps: decks whose look is the point, plain `.deck` files in the vault's `templates/slides/`. Reading
// them, starting a deck from one, and renaming, copying and trashing them. Every write to the vault goes through the core's ops (the
// client); the deck's own engine does the deck's side of it, so what the vault holds is what the editor reads.

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import type { Deck } from "@kasten-slides/wasm";

import type { VaultClient } from "../../lib/vault/types";

/** A template read from the vault: its path, text and hash, and the deck the text is. */
export interface TemplateFile {
  path: string;
  text: string;
  hash: string;
  deck: Deck;
}

/** Reads the template at `path`. */
export async function readTemplate(client: VaultClient, path: string): Promise<TemplateFile> {
  const file = await client.deck(path);
  return { path, text: file.text, hash: file.hash, deck: JSON.parse(file.text) as Deck };
}

/** The text of a new deck made of the template at `path`: its look, its shape, and with `examples` its slides. */
export async function deckFromTemplate(client: VaultClient, path: string, title: string, examples: boolean): Promise<string> {
  const [file] = await Promise.all([client.deck(path), loadSlides()]);
  const engine = DeckEngine.fromTemplate(file.text, title, examples);
  try {
    return engine.save();
  } finally {
    engine.dispose();
  }
}

/** Gives the template another name: its title changes, and the file keeps its own. */
export async function renameTemplate(client: VaultClient, path: string, title: string): Promise<void> {
  const name = title.trim();
  if (!name) return;
  const [file] = await Promise.all([client.deck(path), loadSlides()]);
  const engine = DeckEngine.open(file.text);
  try {
    if (engine.deck.title === name) return;
    engine.apply("set_title", { title: name });
    const saved = await client.saveDeck(path, engine.save(), file.hash);
    if (saved.status === "conflict") throw new Error("The template changed while you were renaming it. Try again.");
  } finally {
    engine.dispose();
  }
}

/** Saves a copy of the template under `title` as a template of its own, with an id of its own; answers its path. */
export async function duplicateTemplate(client: VaultClient, path: string, title: string): Promise<string> {
  const [file] = await Promise.all([client.deck(path), loadSlides()]);
  const engine = DeckEngine.fromTemplate(file.text, title.trim(), true);
  try {
    return await client.createDeckTemplate(title.trim(), engine.save());
  } finally {
    engine.dispose();
  }
}

/** Moves the template to the trash, where it can be put back. Nothing is deleted. */
export async function trashTemplate(client: VaultClient, path: string): Promise<void> {
  await client.trash(path);
}

/** The layouts a template brings that the built-in themes do not have. */
export function ownLayoutsOf(deck: Deck, builtIn: readonly string[]) {
  return deck.theme.layouts.filter((layout) => !builtIn.includes(layout.name));
}
