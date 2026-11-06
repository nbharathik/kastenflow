// The font files a deck carries, put in an exported page so that it looks the same where the fonts are not installed. A font goes in only
// when the person marked its licence as allowing that; the others are told of and the page falls back on the reader's own fonts.

import type { Deck, DeckFont } from "@kasten-slides/wasm";

import { fontFaceCss, fontFormat } from "../editor/fonts/font-css.ts";
import type { SlidesHost } from "../editor/host.ts";

const MIME = { woff2: "font/woff2", woff: "font/woff", truetype: "font/ttf", opentype: "font/otf" } as const;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export interface PageFonts {
  /** `@font-face` rules with the font files as data, ready for the page's style. */
  css: string;
  /** What was left out, and why, in words for a person. */
  notes: string[];
}

/** The style rules and notes for the fonts of a deck, read through the host. */
export async function fontsForPage(deck: Deck, host: Pick<SlidesHost, "readImage">): Promise<PageFonts> {
  const notes: string[] = [];
  const urls = new Map<string, string>();
  const kept: DeckFont[] = [];
  for (const font of deck.present.fonts ?? []) {
    if (font.embeddable !== true) {
      notes.push(`The font ${font.family} is not put in the page, because its licence was not marked as allowing it; where it is not installed another font stands in.`);
      continue;
    }
    const format = fontFormat(font.src);
    let bytes: Uint8Array | undefined;
    try {
      bytes = await host.readImage?.(font.src);
    } catch {
      bytes = undefined;
    }
    if (!bytes || format === null) {
      notes.push(`The font file ${font.src} could not be read, so the page uses another font for ${font.family}.`);
      continue;
    }
    urls.set(font.src, `data:${MIME[format]};base64,${base64(bytes)}`);
    kept.push(font);
  }
  return { css: fontFaceCss(kept, (path) => urls.get(path)), notes };
}
