// Where selected text can come from. A source says what is selected in its
// editor right now; the chat asks them in turn. The page, the PDF reader and a
// slide's text box are registered here (dom-sources.ts); the LaTeX editor
// registers its own with `registerSelectionSource("latex", ...)` when it is
// there, without the chat knowing about it.

import type { SelectionSource } from "../types";

/** What is selected, and where it is. */
export interface SelectionSnapshot {
  source: SelectionSource;
  text: string;
  /** The heading it sits under, when it sits under one. */
  heading?: string;
  /** Where it is in the source, in characters, when the source can say. */
  range?: { from: number; to: number };
  /** The name of the page, PDF, deck or document, for the chip. */
  title: string;
}

/** Answers what is selected in this source now, or none. */
export type SelectionGetter = () => SelectionSnapshot | null;

type Kind = SelectionSource["kind"];

/** The order they are asked in: a slide's text box is inside the deck's view, so it goes before anything wider. */
const ORDER: readonly Kind[] = ["slide", "pdf", "latex", "page"];

const getters = new Map<Kind, SelectionGetter>();

/** Registers the source of one kind (a later one replaces it). Returns how to take it away. */
export function registerSelectionSource(kind: Kind, getter: SelectionGetter): () => void {
  getters.set(kind, getter);
  return () => {
    if (getters.get(kind) === getter) getters.delete(kind);
  };
}

/** The selection of the first source that has one. */
export function currentSelection(): SelectionSnapshot | null {
  for (const kind of ORDER) {
    const found = getters.get(kind)?.();
    if (found && found.text.trim() !== "") return found;
  }
  return null;
}

/** A selection shorter than this is not offered (a stray double-click on a word is not a question). */
export const MIN_SELECTION = 3;
