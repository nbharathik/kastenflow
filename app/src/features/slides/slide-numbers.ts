// Slide numbers for decks that already exist. A new deck is made with them off, but a deck made before that has them on, and a person who
// does not want them turns them off deck by deck (Slide numbers in the slide options) or, here, for every deck of the vault at once:
// a command that goes through the decks reads each one's text, asks this for the text it should have, and saves that through the
// vault when there is one. Nothing is written here; the change itself is the Slides core's `set_present` operation.

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";

import type { DeckEdit, VaultClient } from "../../lib/vault/types";

/**
 * The text of a deck with its slide numbers turned `on` or off, or null when it has them that way already (so nothing needs saving).
 * Throws, in words a person can read, when the text is not a deck this build can open.
 */
export async function withSlideNumbers(text: string, on: boolean): Promise<string | null> {
  await loadSlides();
  const engine = DeckEngine.open(text);
  try {
    if (engine.deck.present.slideNumbers === on) return null;
    engine.apply("set_present", { slideNumbers: on });
    return engine.save();
  } finally {
    engine.dispose();
  }
}

/** The text of a deck with its slide numbers off, or null when they are off already. */
export const withoutSlideNumbers = (text: string): Promise<string | null> => withSlideNumbers(text, false);

/** A deck whose slide numbers would be turned off: what to write, and the hash of the file it was worked out from. */
export interface NumberedDeck extends DeckEdit {
  title: string;
}

/** A deck that could not be looked at, and why: it is listed apart and never written. */
export interface UnreadableDeck {
  path: string;
  title: string;
  why: string;
}

export interface NumberedDecks {
  /** The decks that show slide numbers, by title. */
  affected: NumberedDeck[];
  /** The decks that could not be read: left as they are. */
  unreadable: UnreadableDeck[];
  /** How many decks were looked at. */
  looked: number;
}

/** Every deck of the vault, looked at: which show slide numbers (with the text they would have without), and which cannot be read. Templates are not decks of the person's and are not among them. */
export async function decksWithNumbers(client: VaultClient): Promise<NumberedDecks> {
  const found: NumberedDecks = { affected: [], unreadable: [], looked: 0 };
  for (const info of await client.decks()) {
    found.looked += 1;
    if (info.problem) {
      found.unreadable.push({ path: info.path, title: info.title, why: info.problem });
      continue;
    }
    try {
      const file = await client.deck(info.path);
      const text = await withoutSlideNumbers(file.text);
      if (text !== null) found.affected.push({ path: info.path, title: info.title, baseHash: file.hash, text });
    } catch (error) {
      found.unreadable.push({ path: info.path, title: info.title, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return found;
}

/** The one line the history keeps for turning them off in these decks. */
export const numbersMessage = (count: number): string => `slides: turn off slide numbers in ${count} deck${count === 1 ? "" : "s"}`;
