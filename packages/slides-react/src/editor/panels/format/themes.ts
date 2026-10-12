import { DeckEngine, type Colors, type Deck, builtInThemes } from "@kasten-slides/wasm";

/** A built-in theme, and its colours for a strip on its card. */
export interface ThemeChoice {
  name: string;
  colors: Colors | null;
  /** A deck of the theme with its example slides, for drawing a card's thumbnail; null where the engine is not loaded. */
  sample: Deck | null;
}

const FALLBACK = ["Light", "Dark", "Serif", "Lecture", "Minimal", "Bold", "Modern", "Academic", "Pitch", "Dark Studio", "Warm Paper"];

let known: ThemeChoice[] | null = null;

/** The choices if they have been made already (the first time costs a deck for each theme); null before that. */
export const knownThemeChoices = (): ThemeChoice[] | null => known;

/** The themes by name alone, which costs nothing: for a card to be drawn at once, and its drawing to follow. */
export function themeNames(): ThemeChoice[] {
  try {
    return builtInThemes().map((name) => ({ name, colors: null, sample: null }));
  } catch {
    return FALLBACK.map((name) => ({ name, colors: null, sample: null }));
  }
}

/** The built-in themes, in the order the engine lists them, each with its palette and a sample deck. They are made once, from a deck in each theme. */
export function themeChoices(): ThemeChoice[] {
  if (known) return known;
  try {
    known = builtInThemes().map((name) => {
      const engine = DeckEngine.create("Your title", name, 1, { examples: true });
      const sample = engine.deck;
      engine.dispose();
      return { name, colors: sample.theme.colors, sample };
    });
    return known;
  } catch {
    // The engine is not loaded (a page that has not opened a deck): names only.
    return FALLBACK.map((name) => ({ name, colors: null, sample: null }));
  }
}
