// Slide numbers for decks that already exist. A new deck is made with them off, but a deck made before that has them on, and a person who
// does not want them turns them off deck by deck (Slide numbers in the slide options) or, here, for every deck of the vault at once:
// a command that goes through the decks reads each one's text, asks this for the text it should have, and saves that through the
// vault when there is one. Nothing is written here; the change itself is the Slides core's `set_present` operation.

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";

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
