// Exporting a deck: the file, and the pictures it needs.

import type { Deck } from "./generated/index.ts";

/** What to put in a PowerPoint file. */
export interface ExportOptions {
  /** Write the speaker notes (default true). */
  notes?: boolean;
  /** Keep hidden and backup slides, still hidden in the file (default true). */
  includeHidden?: boolean;
  /**
   * What a slide with steps becomes: `expand` (the default) is a slide for each state, in order,
   * titled "Title (2/5)" with the same words in its notes; `final` is one slide, as it stands
   * after the last click.
   */
  steps?: "expand" | "final" | "animate";
}

/** Something an export could not do exactly, and so did another way. */
export interface ExportWarning {
  slide: string | null;
  element: string | null;
  message: string;
}

export interface PptxExport {
  /** The `.pptx` file. */
  bytes: Uint8Array;
  warnings: ExportWarning[];
}

/** The keys of a deck whose value is the path of a picture in the host's store. */
const PICTURE_KEYS = new Set(["src", "image", "preview"]);

/**
 * The picture paths a deck names, in the order they first appear: the `src`
 * of image elements, background images, and stand-in images of other elements.
 * Anything else that has such a key and a string in it is asked for too; the
 * host says which it has, and the rest is left out of the file.
 */
export function picturePaths(deck: Deck): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value !== null && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (PICTURE_KEYS.has(key) && typeof inner === "string" && inner !== "") found.add(inner);
        else walk(inner);
      }
    }
  };
  walk(deck);
  return [...found];
}

/** The pictures as the WebAssembly call takes them: names, their bytes one after another, and each length. */
export function packPictures(pictures: ReadonlyMap<string, Uint8Array>): { names: string; bytes: Uint8Array; lengths: Uint32Array } {
  const names = [...pictures.keys()];
  const bytes = new Uint8Array(names.reduce((sum, name) => sum + (pictures.get(name)?.length ?? 0), 0));
  const lengths = new Uint32Array(names.length);
  let at = 0;
  names.forEach((name, i) => {
    const picture = pictures.get(name) ?? new Uint8Array();
    bytes.set(picture, at);
    lengths[i] = picture.length;
    at += picture.length;
  });
  return { names: JSON.stringify(names), bytes, lengths };
}
