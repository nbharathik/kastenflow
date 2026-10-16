// Copy, cut and paste as the menus and buttons ask for them: where the focus was decides whether it is the slides or the blocks (the key
// path has the event, which says it). They write and read the system clipboard through the browser's asynchronous API.

import type { CommandContext } from "../commands/types.ts";
import { pasteContents } from "./paste.ts";
import { type Place, placeFor } from "./place.ts";
import { readSystem, withMemory, writeSystem, writeSystemCells } from "./system.ts";

/**
 * Copies (or cuts) what is selected where the person was: the slides in the filmstrip or the grid, the cells picked in a table, the blocks
 * of the slide otherwise. A menu that is about one of them (the one a right click opens on a slide) says which.
 */
export async function copyHere(context: CommandContext, cut = false, place: Exclude<Place, "own"> = placeFor(context)): Promise<void> {
  const { session } = context;
  if (place === "cells") {
    const texts = session.tables.copy();
    if (!texts) return;
    await writeSystemCells(texts);
    // Emptied only once the copy is on the clipboard.
    if (cut) session.tables.clear();
    return;
  }
  const clip = place === "slides" ? (cut ? session.slideClipboard.cut() : session.slideClipboard.copy()) : cut ? session.clipboard.cut() : session.clipboard.copy();
  if (clip) await writeSystem(clip);
}

/** Pastes what the clipboard holds; blocks keep the place they were copied from with `inPlace`. */
export async function pasteHere(context: CommandContext, inPlace = false): Promise<void> {
  await pasteContents(context, withMemory(await readSystem()), { inPlace });
}

/** Pastes the slides the clipboard holds after the slides picked, wherever the focus was (the filmstrip's menu is about slides); anything else on it is left. */
export async function pasteSlidesHere(context: CommandContext): Promise<void> {
  const { clip } = withMemory(await readSystem());
  if (clip?.kind === "slides") context.session.slideClipboard.paste(clip);
}

/** Whether something is selected to copy where the person was. */
export function canCopyHere(context: CommandContext | undefined, selection: readonly string[]): boolean {
  return (context !== undefined && placeFor(context) === "slides") || selection.length > 0;
}
