// Bringing layouts in from another deck: reading that deck, drawing its layouts the way they will look here, and the one operation that
// adds the chosen ones (one step of undo). The engine gives each a name this theme does not have yet and brings along the text styles it
// names and this theme lacks.

import { DeckEngine, type Deck, type Layout, type TextStyle } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";

/** The deck in the text of a `.deck` file. The engine reads it (so an older file is brought up to date) and is let go at once. */
export function readDeck(text: string): Deck {
  const engine = DeckEngine.open(text);
  try {
    return engine.deck;
  } finally {
    engine.dispose();
  }
}

/**
 * A deck to draw the layouts of `from` with, as they will look here: this deck's colours and fonts and the text styles it has, with the
 * ones only `from` has added (those come along when a layout is brought in). Only for drawing; nothing is changed.
 */
export function previewDeck(into: Deck, from: Deck): Deck {
  return { ...into, theme: { ...into.theme, layouts: from.theme.layouts, textStyles: { ...from.theme.textStyles, ...into.theme.textStyles } } };
}

/** The text styles of `from` that these layouts name, for the engine to bring along when this theme lacks them. */
export function textStylesFor(from: Deck, layouts: readonly Layout[]): Record<string, TextStyle> {
  const found: Record<string, TextStyle> = {};
  for (const layout of layouts) {
    for (const slot of layout.placeholders) {
      const style = slot.style ? from.theme.textStyles[slot.style] : undefined;
      if (slot.style && style) found[slot.style] = style;
    }
  }
  return found;
}

/**
 * Adds the layouts of `from` called `names` to this deck; answers the names they were given here, or nothing when the engine refused.
 * The page size of `from` goes with them, so that layouts made for slides of another shape are refitted to this deck's.
 */
export function importLayouts(session: EditorSession, from: Deck, names: readonly string[]): string[] | undefined {
  const layouts = from.theme.layouts.filter((layout) => names.includes(layout.name));
  if (layouts.length === 0) return undefined;
  const done = session.run(() => session.core.apply("import_layouts", { layouts, textStyles: textStylesFor(from, layouts), fromSize: from.size }));
  return done?.output.added;
}
