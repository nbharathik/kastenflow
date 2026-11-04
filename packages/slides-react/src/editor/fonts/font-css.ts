// The fonts a deck carries, as the style rules that make a page draw with them. The editor, the show and the HTML export all use these.

import type { DeckFont } from "@kasten-slides/wasm";

/** The open fonts the program carries with it (see `theme/fonts.css`), so a deck set in them looks the same on every machine. */
export const BUNDLED_FAMILIES: readonly string[] = ["Inter", "Lato", "Roboto", "Roboto Mono", "Carlito", "Caladea", "Liberation Sans", "Liberation Serif", "Liberation Mono"];

/** The kinds of font file a deck may carry. */
export const FONT_EXTENSIONS: readonly string[] = [".ttf", ".otf", ".woff", ".woff2"];

/** What the style rule calls the format of a font file, from its name; null for a file that is not a font. */
export function fontFormat(src: string): "woff2" | "woff" | "truetype" | "opentype" | null {
  const lower = src.trim().toLowerCase().split(/[?#]/)[0] ?? "";
  if (lower.endsWith(".woff2")) return "woff2";
  if (lower.endsWith(".woff")) return "woff";
  if (lower.endsWith(".ttf")) return "truetype";
  if (lower.endsWith(".otf")) return "opentype";
  return null;
}

/** Text for the inside of a quoted CSS string: no quote, backslash or line break gets out of it. */
const quoted = (text: string): string => text.replace(/\p{Cc}/gu, " ").replace(/[\\"]/g, (c) => (c === "\\" ? "\\\\" : "\\\""));

/** An address for `url("...")` that cannot end the string or the rule. */
const safeUrl = (url: string): string => url.replace(/\p{Cc}/gu, "").replace(/"/g, "%22").replace(/\\/g, "%5C");

/**
 * The `@font-face` rules of a deck's fonts. `urlOf` turns the path a deck keeps into an address the page can load (the host's). A font
 * that has no address, or is not a font file, is left out; so is one with no family name.
 */
export function fontFaceCss(fonts: readonly DeckFont[], urlOf: (path: string) => string | undefined): string {
  const rules: string[] = [];
  for (const font of fonts) {
    const family = font.family.trim();
    const format = fontFormat(font.src);
    const url = urlOf(font.src);
    if (family === "" || format === null || !url) continue;
    rules.push(
      `@font-face { font-family: "${quoted(family)}"; font-weight: ${font.bold ? 700 : 400}; font-style: ${font.italic ? "italic" : "normal"}; font-display: swap; src: url("${safeUrl(url)}") format("${format}"); }`,
    );
  }
  return rules.join("\n");
}

/** The fonts whose licence the person said lets them travel inside an exported file. */
export const embeddable = (fonts: readonly DeckFont[]): DeckFont[] => fonts.filter((font) => font.embeddable === true);

/** The families a deck's fonts add, once each, in the order they were added. */
export function familiesOf(fonts: readonly DeckFont[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const font of fonts) {
    const family = font.family.trim();
    if (family !== "" && !seen.has(family.toLowerCase())) {
      seen.add(family.toLowerCase());
      out.push(family);
    }
  }
  return out;
}

/** A family name taken from a font file's name: `Inter-BoldItalic.woff2` gives `Inter`; the weight and style it names come with it. */
export function describeFile(fileName: string): { family: string; bold: boolean; italic: boolean } {
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, "");
  const bold = /bold|black|heavy|semibold/i.test(base);
  const italic = /italic|oblique/i.test(base);
  const family = base
    .replace(/[-_ ]?(regular|bold|italic|oblique|light|medium|semibold|black|heavy|thin|book|roman)+$/i, "")
    .replace(/(?:[-_ ]?(?:regular|bold|italic|oblique|light|medium|semibold|black|heavy|thin|book|roman))+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return { family: family || base, bold, italic };
}
