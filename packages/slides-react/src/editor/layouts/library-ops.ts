// What using the layout library does to a deck. Every change to the deck is an operation of the engine, so each is one step of undo and a
// refusal is told to the person (the session's `run`). A library layout is always copied: the deck holds its own layout, marked with the
// entry it came from, and opens without the library. The names the engine gives are worked out first on a scratch copy of the deck,
// so that the operations of one step can name each other.

import { DeckEngine, type Deck, type ImportLayouts, type Layout, type Slide } from "@kasten-slides/wasm";

import { readDeck, textStylesFor } from "../dialogs/import-layouts.ts";
import type { EditorSession } from "../session/session.ts";
import type { LayoutLibraryHost } from "./library-host.ts";
import { type LibraryLayout, libraryIdOf, libraryText, marked, newLibraryId, readLibraryText } from "./library.ts";
import type { SaveAsLayout } from "./ops.ts";

type BatchOp = Parameters<DeckEngine["applyBatch"]>[0][number];

/** The layout of the deck that is a copy of the library entry `id`, if it has one. */
export const copyOf = (deck: Deck, id: string): Layout | undefined => deck.theme.layouts.find((layout) => libraryIdOf(layout) === id);

/** What brings a library layout in: marked as a copy, with its text styles, refitted when it was drawn for another page size. */
function importInput(entry: LibraryLayout): ImportLayouts {
  return { layouts: [marked(entry.layout, entry.id)], textStyles: entry.textStyles, fromSize: entry.size };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Puts a copy of the library layout in the deck, unless the deck has one already (using a layout twice does not make two). Answers the
 * name of the copy, or nothing when the engine refused.
 */
export function copyLibraryLayout(session: EditorSession, entry: LibraryLayout): string | undefined {
  const have = copyOf(session.deck, entry.id);
  if (have) return have.name;
  const done = session.run(() => session.core.apply("import_layouts", importInput(entry)));
  return done?.output.added[0];
}

/**
 * Sets the deck's copy of a library layout (`name`) to the library's version, as the layout designer's Done does: the layout keeps its name,
 * and the slides that use it follow (a slot left at the layout's place moves with it; what filled a slot that is gone stays as a plain
 * element, and its ids are answered). One step of undo. Nothing when the engine refused.
 */
export function updateFromLibrary(session: EditorSession, name: string, entry: LibraryLayout): { detached: string[] } | undefined {
  let design: Slide | undefined;
  const scratch = DeckEngine.open(session.core.save());
  try {
    const added = scratch.apply("import_layouts", importInput(entry)).output.added[0];
    design = added === undefined ? undefined : readDeck(scratch.layoutDesign(added)).slides[0];
  } catch (error) {
    session.host.notify?.(messageOf(error));
    return undefined;
  } finally {
    scratch.dispose();
  }
  const drawn = design;
  if (!drawn) return undefined;
  const hideMaster = entry.layout.hideMaster === true;
  const done = session.run(() => session.core.apply("set_layout_design", { name, design: drawn, hideMaster }));
  return done ? { detached: done.output.detached } : undefined;
}

/**
 * The operations that swap the layout `name` for a copy of itself that is marked as the library entry `id`: the copy goes where the layout
 * was, the slides move to it, and a layout that new slides start from stays so. They are also applied to `scratch`, so that more can follow.
 */
function relinkOps(scratch: DeckEngine, name: string, id: string): { ops: BatchOp[]; copy: string } {
  const layouts = scratch.deck.theme.layouts;
  const at = layouts.findIndex((layout) => layout.name === name);
  const layout = layouts[at];
  if (!layout) throw new Error(`The deck has no layout ${name}.`);
  const input: ImportLayouts = { layouts: [marked(layout, id)], textStyles: textStylesFor(scratch.deck, [layout]) };
  const copy = scratch.apply("import_layouts", input).output.added[0];
  if (copy === undefined) throw new Error("The layout could not be copied.");
  const ops: BatchOp[] = [
    ["import_layouts", input],
    ["delete_layout", { name, moveTo: copy }],
  ];
  const wasDefault = scratch.deck.theme.newSlideLayout === name;
  scratch.apply("delete_layout", { name, moveTo: copy });
  if (wasDefault) ops.push(["edit_layout", { name: copy, defaultForNew: true }]);
  ops.push(["move_layout", { name: copy, to: at }]);
  return { ops, copy };
}

/**
 * Saves the slide shown as a layout that every deck has: the library keeps it, and this deck holds a copy marked as that entry (so
 * "Update from library" works here too). Answers the name of the layout in this deck, or nothing when it did not work. The library is
 * written first: if it cannot be, the deck is not changed.
 */
export async function saveSharedLayout(session: EditorSession, library: LayoutLibraryHost, input: SaveAsLayout): Promise<string | undefined> {
  const { slide = session.state.slideId, label, roles, useForSlide = true, newSlideDefault = false } = input;
  const asked = { slide, label, roles, useForSlide, newSlideDefault };
  const id = newLibraryId();
  const scratch = DeckEngine.open(session.core.save());
  let text: string | undefined;
  let ops: BatchOp[];
  let copy: string;
  try {
    const made = scratch.apply("save_layout", asked).output.layout;
    text = libraryText(scratch.deck, made, id);
    const relinked = relinkOps(scratch, made, id);
    // A layout that new slides start from is still that after the swap (`relinkOps`).
    ops =[["save_layout", asked], ...relinked.ops];
    copy = relinked.copy;
  } catch (error) {
    session.host.notify?.(messageOf(error));
    return undefined;
  } finally {
    scratch.dispose();
  }
  if (text === undefined) return undefined;
  try {
    await library.save(text);
  } catch (error) {
    session.host.notify?.(`Your layouts could not be saved: ${messageOf(error)}`);
    return undefined;
  }
  const done = session.run(() => session.core.applyBatch(ops));
  return done ? copy : undefined;
}

/**
 * Adds the deck's layout `name` to the library, or, when it is a copy of an entry, sends this deck's version to that entry. A layout that is
 * added becomes a marked copy in this deck, so that it can be updated later. Answers what was done, or nothing when it did not work.
 */
export async function sendToLibrary(session: EditorSession, library: LayoutLibraryHost, name: string): Promise<"added" | "updated" | undefined> {
  const layout = session.deck.theme.layouts.find((candidate) => candidate.name === name);
  if (!layout) return undefined;
  const known = libraryIdOf(layout);
  const id = known ?? newLibraryId();
  const previous = known === undefined ? undefined : await library.read(known).catch(() => undefined);
  const text = libraryText(session.deck, name, id, previous);
  if (text === undefined) return undefined;
  try {
    await library.save(text);
  } catch (error) {
    session.host.notify?.(`Your layouts could not be saved: ${messageOf(error)}`);
    return undefined;
  }
  if (known !== undefined) return "updated";
  const scratch = DeckEngine.open(session.core.save());
  let ops: BatchOp[];
  try {
    ops = relinkOps(scratch, name, id).ops;
  } catch (error) {
    session.host.notify?.(messageOf(error));
    return undefined;
  } finally {
    scratch.dispose();
  }
  return session.run(() => session.core.applyBatch(ops)) ? "added" : undefined;
}

/**
 * "Update from library" for the deck's layout `name`: reads the entry it is a copy of and sets the layout to it. Says what happened. Answers
 * whether the layout was updated.
 */
export async function refreshFromLibrary(session: EditorSession, library: LayoutLibraryHost, name: string): Promise<boolean> {
  const layout = session.deck.theme.layouts.find((candidate) => candidate.name === name);
  const id = layout ? libraryIdOf(layout) : undefined;
  if (!layout || id === undefined) return false;
  const entry = await readEntry(library, id);
  if (!entry) {
    session.host.notify?.(`“${layout.label}” is no longer in My layouts. This deck keeps its copy.`);
    return false;
  }
  const done = updateFromLibrary(session, name, entry);
  if (!done) return false;
  const lost = done.detached.length;
  session.host.notify?.(lost === 0 ? `Updated “${layout.label}” from My layouts.` : `Updated “${layout.label}” from My layouts. ${lost === 1 ? "One element" : `${lost} elements`} that filled a slot it no longer has stayed on its slide.`);
  return true;
}

/** The entry `id` of the library, read; nothing when the host lost it or its file is not a layout. */
export async function readEntry(library: LayoutLibraryHost, id: string): Promise<LibraryLayout | undefined> {
  const text = await library.read(id).catch(() => undefined);
  return text === undefined ? undefined : readLibraryText(text);
}
