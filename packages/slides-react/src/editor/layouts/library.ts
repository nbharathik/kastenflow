// A library layout as a file: what the editor writes for the host's layout library and reads back. The file is a layout as a deck's theme
// holds it, the text styles its slots name and the page size it was drawn for, under an id that never changes. A copy of it in a deck
// remembers that id in a field the deck format does not list (it is kept with the layout, so every build keeps it), which is how
// "Update from library" finds the entry again. Colours and fonts are theme tokens and style names, so a copy takes on the look of the
// deck it lands in.

import type { Deck, Layout, Size, TextStyle } from "@kasten-slides/wasm";

import { textStylesFor } from "../dialogs/import-layouts.ts";

/** The `format` of a library file. */
export const LIBRARY_FORMAT = "kasten-layout";

/** The field a copy of a library layout carries in a deck: `{ id }`. */
export const LIBRARY_KEY = "x-library";

/** A library file, read. */
export interface LibraryLayout {
  id: string;
  label: string;
  /** The page size the layout was drawn for. */
  size: Size;
  layout: Layout;
  textStyles: Record<string, TextStyle>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** An id no other entry has: letters and digits, `L-` first. */
export function newLibraryId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `L-${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("")}`;
}

/** The id of the library entry a layout of a deck is a copy of, if it is one. */
export function libraryIdOf(layout: Layout): string | undefined {
  const mark = (layout as unknown as Record<string, unknown>)[LIBRARY_KEY];
  return isObject(mark) && typeof mark.id === "string" && mark.id !== "" ? mark.id : undefined;
}

/** The layout without the mark of a library entry. */
export function unmarked(layout: Layout): Layout {
  const copy = { ...(layout as unknown as Record<string, unknown>) };
  delete copy[LIBRARY_KEY];
  return copy as unknown as Layout;
}

/** The layout marked as a copy of the library entry `id`. */
export function marked(layout: Layout, id: string): Layout {
  return { ...layout, [LIBRARY_KEY]: { id } } as unknown as Layout;
}

/**
 * The text of the library file for the layout `name` of `deck`, under the entry `id`. With `previous` (the entry's file as it is now) every
 * field the editor does not know stays, and the file keeps the order it had; otherwise it is a new file. Nothing when the deck has no such layout.
 */
export function libraryText(deck: Deck, name: string, id: string, previous?: string): string | undefined {
  const found = deck.theme.layouts.find((layout) => layout.name === name);
  if (!found) return undefined;
  const layout = unmarked(found);
  const before = previous === undefined ? undefined : safeParse(previous);
  const base = isObject(before) && before.id === id ? before : {};
  const file = {
    ...base,
    format: LIBRARY_FORMAT,
    formatVersion: typeof base.formatVersion === "number" ? base.formatVersion : 1,
    id,
    label: layout.label,
    size: deck.size,
    layout,
    textStyles: textStylesFor(deck, [layout]),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** The deck to draw library layouts with: its colours, fonts and text styles, and the styles only the layouts name. Only for drawing. */
export function drawnWith(deck: Deck, layouts: readonly LibraryLayout[]): Deck {
  const styles: Record<string, TextStyle> = {};
  for (const item of layouts) Object.assign(styles, item.textStyles);
  return { ...deck, theme: { ...deck.theme, textStyles: { ...styles, ...deck.theme.textStyles } } };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A library file, read; nothing when the text is not one or lacks what a copy needs. */
export function readLibraryText(text: string): LibraryLayout | undefined {
  const file = safeParse(text);
  if (!isObject(file) || file.format !== LIBRARY_FORMAT) return undefined;
  const { id, label, size, layout, textStyles } = file;
  if (typeof id !== "string" || id === "" || typeof label !== "string" || label.trim() === "") return undefined;
  if (!isObject(layout) || typeof layout.name !== "string" || !Array.isArray(layout.placeholders)) return undefined;
  if (!isObject(size) || typeof size.w !== "number" || typeof size.h !== "number" || !(size.w > 0) || !(size.h > 0)) return undefined;
  return {
    id,
    label: label.trim(),
    size: { w: size.w, h: size.h },
    layout: layout as unknown as Layout,
    textStyles: isObject(textStyles) ? (textStyles as Record<string, TextStyle>) : {},
  };
}
