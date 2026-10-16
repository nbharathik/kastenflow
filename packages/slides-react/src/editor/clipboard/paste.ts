// What a paste does with what the clipboard holds, whichever way it was read (a paste event, or the menu's asking the browser):
//   blocks or slides Kasten copied    go on the slide, or after the slide, as a copy does
//   a picture                         a picture on the slide, where the pointer was
//   words, or the words of HTML       a text box there
// Where the pointer was is where it last was over the slide, else the middle of it.

import { pointerOf } from "../canvas/pointer.ts";
import { insertImageFiles } from "../commands/insert.ts";
import type { CommandContext } from "../commands/types.ts";
import { type ClipContents, picturesOfHtml, wordsOfHtml } from "./format.ts";
import { placeFor } from "./place.ts";
import { cellsFromContents } from "./table.ts";

export interface PasteOptions {
  /** Keep the place the blocks were copied from (Paste in place), instead of stepping from it. */
  inPlace?: boolean;
}

/** Pastes `contents` into the editor of `context`. Resolves when it is done; a picture takes a moment to be kept. */
export async function pasteContents(context: CommandContext, contents: ClipContents, options: PasteOptions = {}): Promise<void> {
  const { session, ui } = context;
  const { clip } = contents;
  // With cells picked in a table, what is pasted is cells: the words of a spreadsheet, a table of a page, or cells copied here. Blocks or
  // slides that Kasten copied are not, and a picture is not: they go on as they always do, and the cells are let go.
  if (session.state.cells !== null && session.state.editing === null && placeFor(context) === "cells") {
    if (clip) session.selectCells(null);
    else if (contents.files.length === 0) {
      const cells = cellsFromContents(contents);
      if (cells) {
        session.tables.paste(cells);
        return;
      }
    }
  }
  if (clip?.kind === "slides") {
    session.slideClipboard.paste(clip);
    return;
  }
  if (clip?.kind === "elements") {
    session.clipboard.pasteElements(clip, options.inPlace === undefined ? {} : { inPlace: options.inPlace });
    return;
  }
  const at = pointerOf(ui).slidePoint() ?? undefined;
  const pictures = contents.files.length > 0 ? contents.files : picturesOfHtml(contents.html);
  if (pictures.length > 0) {
    await insertImageFiles(context, pictures, { source: "pasted", ...(at ? { at } : {}) });
    return;
  }
  const words = contents.text.trim() || wordsOfHtml(contents.html);
  if (words) session.clipboard.pasteText(words, at);
}
