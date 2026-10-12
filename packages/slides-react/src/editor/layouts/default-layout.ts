// Which layouts are the person's own, and which one "my default layout" stands for.

import { type Deck, builtInLayouts } from "@kasten-slides/wasm";

import { blankLayoutOf } from "../session/slides.ts";

let builtIn: Set<string> | null = null;

/** Whether a layout is one the person made (or came with the deck): it is not among the twelve every built-in theme has. */
export function isOwnLayout(name: string): boolean {
  if (!builtIn) {
    try {
      builtIn = new Set(builtInLayouts());
    } catch {
      // The engine is not loaded: nothing can be told apart yet.
      return false;
    }
  }
  return !builtIn.has(name);
}

/** The layouts as the menus list them: the person's own first (with a dozen built-in ones above them they would be a scroll away), then the built-in ones, each group in the theme's order. */
export function ownFirst<T extends { name: string }>(layouts: readonly T[]): T[] {
  return [...layouts.filter((layout) => isOwnLayout(layout.name)), ...layouts.filter((layout) => !isOwnLayout(layout.name))];
}

/** The layout the deck marks as the one new slides start from, if it has that layout. */
export function markedDefault(deck: Deck): string | undefined {
  const { newSlideLayout, layouts } = deck.theme;
  return newSlideLayout ? layouts.find((layout) => layout.name === newSlideLayout)?.name : undefined;
}

/** The layout "my default" stands for: the one the deck marks, or else blank (a deck that marks none behaves as it did). */
export const myDefaultLayout = (deck: Deck): string | undefined => markedDefault(deck) ?? blankLayoutOf(deck);
