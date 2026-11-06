// A font file the person chose: it is kept with the deck's files, and the deck lists it with the family, weight and style its name says.

import type { DeckFont } from "@kasten-slides/wasm";

import { pickFiles } from "../files.ts";
import type { EditorSession } from "../session/session.ts";
import { FONT_EXTENSIONS, describeFile, fontFormat } from "./font-css.ts";

/** The biggest font file the editor takes: a font is a few hundred kilobytes, and a deck is a file that is sent about. */
export const MOST_FONT_BYTES = 8 * 1024 * 1024;

/** The entry of the deck's font list for a file of this name kept at `path`. Not allowed into exports until the person says so. */
export function fontEntry(fileName: string, path: string): DeckFont {
  const { family, bold, italic } = describeFile(fileName);
  return { family, src: path, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) } as DeckFont;
}

/**
 * Asks for a font file and keeps it. Resolves to the entry for the deck's list, or to null when nothing was chosen, the file is not a
 * font or is too big, or the host would not keep it; the person is told why in the last three cases.
 */
export async function importFontFile(session: EditorSession): Promise<DeckFont | null> {
  const [file] = await pickFiles(FONT_EXTENSIONS.join(","));
  if (!file) return null;
  if (fontFormat(file.name) === null) {
    session.host.notify?.(`“${file.name}” is not a font file: use .ttf, .otf, .woff or .woff2.`);
    return null;
  }
  if (file.size > MOST_FONT_BYTES) {
    session.host.notify?.(`“${file.name}” is bigger than 8 MB, which is more than a deck should carry.`);
    return null;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = await session.host.addImage(file.name, bytes, { source: "file" });
    return fontEntry(file.name, path);
  } catch (error) {
    session.host.notify?.(error instanceof Error && error.message ? error.message : `“${file.name}” could not be kept with the deck.`);
    return null;
  }
}
