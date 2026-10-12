// What the exported web page carries so that it needs nothing from outside: the pictures of the deck as data URLs, and the fonts its
// text is set in, only the faces (and only the scripts) the deck's words use.

import type { Deck } from "@kasten-slides/wasm";
import { picturePaths } from "@kasten-slides/wasm";

import type { SlidesHost } from "../editor/host.ts";
import { type FontReader, readFont } from "./katex-css.ts";
import { posterPaths } from "./posters.ts";
import { fontFamiliesIn, fontStacksIn, readSlideSheet } from "./slide-css.ts";

// ---- pictures ----

/** What a picture's bytes are, from their first bytes and failing that the name; null when not a picture a page can show. */
export function mimeOf(path: string, bytes: Uint8Array): string | null {
  const at = (...codes: number[]) => codes.every((code, i) => bytes[i] === code);
  if (at(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return /\.avif$/i.test(path) ? "image/avif" : null;
}

/** Bytes as base64 text. */
export function base64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

export const dataUrl = (bytes: Uint8Array, mime: string): string => `data:${mime};base64,${base64(bytes)}`;

/** The files of videos, which the deck names with `src` as it names pictures, and which are not put in the page. */
export const VIDEO_FILE = /\.(mp4|webm|mov|m4v|ogv|mkv)$/i;

/** Every picture the deck names that the host can give, as data URLs by the path the deck names it with. */
export async function readPictures(host: Pick<SlidesHost, "imageUrl" | "readImage">, deck: Deck): Promise<{ found: Map<string, string>; missing: string[] }> {
  const found = new Map<string, string>();
  const missing: string[] = [];
  await Promise.all(
    [...new Set([...picturePaths(deck), ...posterPaths(deck)])]
      .filter((path) => !VIDEO_FILE.test(path))
      .map(async (path) => {
        try {
          let bytes: Uint8Array | undefined;
          if (host.readImage) {
            bytes = await host.readImage(path);
          } else {
            const url = host.imageUrl(path);
            if (url) {
              const response = await fetch(url);
              if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
            }
          }
          const mime = bytes ? mimeOf(path, bytes) : null;
          if (bytes && mime) found.set(path, dataUrl(bytes, mime));
          else missing.push(path);
        } catch {
          missing.push(path);
        }
      }),
  );
  return { found, missing };
}

// ---- fonts ----

/** Every character the deck's words use, as code points; plain ASCII is always in, for numbers and labels. */
export function codePointsOf(deck: Deck): Set<number> {
  const points = new Set<number>();
  for (let code = 0x20; code < 0x7f; code++) points.add(code);
  const walk = (value: unknown): void => {
    if (typeof value === "string") for (const char of value) points.add(char.codePointAt(0) as number);
    else if (Array.isArray(value)) for (const item of value) walk(item);
    else if (value !== null && typeof value === "object") for (const inner of Object.values(value)) walk(inner);
  };
  walk(deck.slides);
  walk(deck.title);
  walk(deck.present.stepLabel);
  walk(deck.theme.master);
  // The words a layout a person made draws behind its slides.
  for (const layout of deck.theme.layouts ?? []) walk(layout.elements);
  return points;
}

/** Whether a `unicode-range` value has any of the code points. An empty range covers all of them. */
export function rangeCovers(range: string, points: ReadonlySet<number>): boolean {
  const text = range.trim();
  if (text === "") return true;
  for (const item of text.split(",")) {
    const match = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(item);
    if (!match) return true;
    const first = match[1] as string;
    const low = Number.parseInt(first.replaceAll("?", "0"), 16);
    const high = match[2] ? Number.parseInt(match[2], 16) : first.includes("?") ? Number.parseInt(first.replaceAll("?", "f"), 16) : low;
    for (const point of points) if (point >= low && point <= high) return true;
  }
  return false;
}

export interface PageStyles {
  /** The renderer's rules and the `@font-face` rules with their fonts inline. */
  css: string;
  /** Families the text is set in that the page could not give a font file for. */
  missing: string[];
}

export interface PageStyleOptions {
  sheets?: ArrayLike<CSSStyleSheet>;
  reader?: FontReader;
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit", "initial", "unset"]);

/** The rules that draw a slide, from the page that has them, and the fonts of the families the markup names (faces the words do not need are left out). */
export async function pageStyles(markup: string, deck: Deck, { sheets, reader = readFont }: PageStyleOptions = {}): Promise<PageStyles> {
  const sheet = readSlideSheet(sheets);
  const named = fontFamiliesIn(markup);
  const wanted = new Set([...named].map((name) => name.toLowerCase()));
  const points = codePointsOf(deck);
  const italic = /font-style:\s*italic/i.test(markup) || /<(?:em|i)[\s>]/.test(markup);
  const faces = sheet.faces.filter((face) => wanted.has(face.family.toLowerCase()) && (face.style !== "italic" || italic) && rangeCovers(face.range, points));
  const data = await Promise.all(faces.map((face) => reader(face.url)));
  const have = new Set<string>();
  const rules = faces.flatMap((face, i) => {
    const url = data[i];
    if (!url) return [];
    have.add(face.family.toLowerCase());
    const range = face.range ? `unicode-range:${face.range};` : "";
    return [`@font-face{font-family:"${face.family}";font-weight:${face.weight};font-style:${face.style};${range}src:url("${url}")}`];
  });
  // A stack's first family is the one wanted; the rest are what to fall back on.
  const missing = [...new Set(fontStacksIn(markup).map((stack) => stack[0] as string))].filter((name) => !GENERIC.has(name.toLowerCase()) && !have.has(name.toLowerCase()));
  return { css: [...rules, ...sheet.rules].join("\n"), missing };
}
