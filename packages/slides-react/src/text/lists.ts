// What a list shows in front of its items, which number each numbered item has,
// and how far in a paragraph sits. The same rules as `slides-core`'s `list`
// module (`fixtures/text/lists.json` holds cases that both are tested against), so
// a line breaks in the same place in the editor and in the file.

import type { ListKind, ListStyle, Paragraph } from "@kasten-slides/wasm";

import { ptToPx } from "./css.ts";
import { AIR, BULLET_GLYPHS, HANG_STEP, LIST_INDENT, LIST_STEP, MOST_HANGING } from "./metrics.ts";

/** The deepest list level: PowerPoint and Google Slides offer nine. */
export const MAX_LEVEL = 8;

/** The bits of a paragraph that decide how it is listed. */
export type Listed = Pick<Paragraph, "list" | "level" | "listStyle" | "start" | "marginLeft" | "indent">;

/** The level of a paragraph as a whole number from 0 to the deepest. */
export function levelOf(paragraph: Pick<Paragraph, "level">): number {
  const level = paragraph.level;
  return typeof level === "number" && Number.isFinite(level) ? Math.min(MAX_LEVEL, Math.max(0, Math.floor(level))) : 0;
}

export const BULLET_STYLES: readonly ListStyle[] = ["disc", "circle", "square", "arrow", "check", "dash"];
export const NUMBER_STYLES: readonly ListStyle[] = ["decimal", "decimalParen", "lowerAlpha", "upperAlpha", "lowerRoman", "upperRoman"];

/** Whether a bullet list or a numbered one shows this style. */
export const kindOfStyle = (style: ListStyle): ListKind => (BULLET_STYLES.includes(style) ? "bullet" : "number");

/** The style a list of `kind` has at `level` when nothing says otherwise: ● ○ ■ and `1.` `a.` `i.`, round again after three. */
export function defaultStyle(kind: ListKind, level: number): ListStyle {
  const at = Math.abs(Math.floor(level)) % 3;
  if (kind === "bullet") return (["disc", "circle", "square"] as const)[at] ?? "disc";
  return (["decimal", "lowerAlpha", "lowerRoman"] as const)[at] ?? "decimal";
}

/** The style a list item shows, or null for a paragraph that is not one. A style of the other kind of list than the paragraph's is not used. */
export function styleOf(paragraph: Pick<Listed, "list" | "level" | "listStyle">): ListStyle | null {
  const kind = paragraph.list;
  if (kind !== "bullet" && kind !== "number") return null;
  const own = paragraph.listStyle;
  return own && kindOfStyle(own) === kind ? own : defaultStyle(kind, levelOf(paragraph));
}

/** The glyph a bullet style shows; null for a numbered style. */
export const glyphOf = (style: ListStyle): string | null => BULLET_GLYPHS[style as keyof typeof BULLET_GLYPHS] ?? null;

/** `1` is `a`, `26` is `z`, `27` is `aa`, as a spreadsheet counts its columns. */
function letters(n: number): string {
  let rest = n;
  let out = "";
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** Lower-case Roman numerals up to 3999; beyond that the plain number. */
function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let rest = n;
  let out = "";
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

/** What an item shows in front of it: the glyph of a bullet style, or `3.`, `c)`, `IV.` for the `n`th of a numbered one. */
export function markerText(style: ListStyle, n: number): string {
  const glyph = glyphOf(style);
  if (glyph !== null) return glyph;
  const count = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  switch (style) {
    case "decimalParen":
      return `${count})`;
    case "lowerAlpha":
      return `${letters(count)}.`;
    case "upperAlpha":
      return `${letters(count).toUpperCase()}.`;
    case "lowerRoman":
      return `${roman(count)}.`;
    case "upperRoman":
      return `${roman(count).toUpperCase()}.`;
    default:
      return `${count}.`;
  }
}

/** The marker of a paragraph that is a list item; `indexInRun` is its number, counting from 1. An empty text for any other. */
export function markerFor(paragraph: Pick<Listed, "list" | "level" | "listStyle">, indexInRun: number): string {
  const style = styleOf(paragraph);
  return style === null ? "" : markerText(style, indexInRun);
}

/** The number each numbered paragraph shows, and null for the rest. */
export function listNumbers(paragraphs: readonly Pick<Listed, "list" | "level" | "listStyle" | "start">[]): (number | null)[] {
  // For each level, the count so far and the style it is counted in.
  const counters: { count: number; style: ListStyle | null }[] = [];
  return paragraphs.map((paragraph) => {
    if (paragraph.list !== "number" && paragraph.list !== "bullet") {
      counters.length = 0;
      return null;
    }
    const at = levelOf(paragraph);
    counters.length = Math.min(counters.length, at + 1);
    while (counters.length <= at) counters.push({ count: 0, style: null });
    if (paragraph.list === "bullet") {
      counters[at] = { count: 0, style: null };
      return null;
    }
    const style = styleOf(paragraph);
    const before = counters[at] ?? { count: 0, style: null };
    const start = paragraph.start;
    const n = typeof start === "number" && Number.isFinite(start) ? Math.max(1, Math.floor(start)) : before.style === style ? before.count + 1 : 1;
    counters[at] = { count: n, style };
    return n;
  });
}

/** The marker text of each paragraph, or null for one that is not a list item. */
export function markerTexts(paragraphs: readonly Pick<Listed, "list" | "level" | "listStyle" | "start">[]): (string | null)[] {
  const numbers = listNumbers(paragraphs);
  return paragraphs.map((paragraph, i) => {
    const style = styleOf(paragraph);
    return style === null ? null : markerText(style, numbers[i] ?? 1);
  });
}

/** How wide a marker is in ems, judged generously: a wide face such as Inter or Verdana is assumed. */
export function widthInEms(marker: string): number {
  let total = 0;
  for (const c of marker) {
    if (c === "." || c === ",") total += 0.3;
    else if (c === "(" || c === ")") total += 0.36;
    else if (c === "●" || c === "○" || c === "■") total += 0.62;
    else if (c === "➢") total += 0.92;
    else if (c === "✓") total += 0.8;
    else if (c === "–") total += 0.6;
    else if (c >= "0" && c <= "9") total += 0.62;
    else if (c === "i" || c === "j" || c === "l") total += 0.28;
    else if (c === "I") total += 0.3;
    else if (c === "m" || c === "w") total += 0.85;
    else if (c === "M" || c === "W") total += 0.95;
    else if (c >= "A" && c <= "Z") total += 0.72;
    else total += 0.56;
  }
  return total;
}

/** The widest marker of a style among the first `count` numbers: "viii." is wider than "ix." and "m." than "n.", so the last is not always it. */
function widestMarker(style: ListStyle, count: number): string {
  const scan = 4000;
  let best = "";
  let width = -1;
  const consider = (n: number) => {
    const text = markerText(style, n);
    const w = widthInEms(text);
    if (w > width) {
      best = text;
      width = w;
    }
  };
  for (let n = 1; n <= Math.min(count, scan); n++) consider(n);
  consider(count);
  return best;
}

/** The room, in slide units, that a marker set at `points` needs in front of its text: its width and a little air. */
const roomFor = (marker: string, points: number): number => (widthInEms(marker) + AIR) * ptToPx(points);

/** Whether the paragraph says for itself where its text starts, so its list's room does not count. */
const isPlaced = (p: Pick<Listed, "indent" | "marginLeft">): boolean => typeof p.indent === "number" || typeof p.marginLeft === "number";

/**
 * How far the marker hangs before the text at each level: what the widest marker
 * there needs, in steps of 6 units, and at least `LIST_INDENT`. `points` is the
 * size of each paragraph's marker.
 */
export function hangsByLevel(paragraphs: readonly Listed[], points: readonly number[]): number[] {
  const counts = listNumbers(paragraphs);
  // The largest count of each style at a level: the widest number is not always the last.
  const most = new Map<string, { level: number; style: ListStyle; top: number }>();
  paragraphs.forEach((p, i) => {
    const count = counts[i];
    const style = styleOf(p);
    if (count === null || count === undefined || style === null) return;
    const key = `${levelOf(p)}|${style}`;
    const seen = most.get(key);
    if (seen) seen.top = Math.max(seen.top, count);
    else most.set(key, { level: levelOf(p), style, top: count });
  });
  const widest = new Map<string, string>();
  for (const [key, { style, top }] of most) widest.set(key, widestMarker(style, top));
  const need = new Array<number>(MAX_LEVEL + 1).fill(0);
  paragraphs.forEach((p, i) => {
    const style = styleOf(p);
    if (style === null || isPlaced(p)) return;
    const at = levelOf(p);
    const text = glyphOf(style) ?? widest.get(`${at}|${style}`) ?? markerText(style, 1);
    need[at] = Math.max(need[at] ?? 0, roomFor(text, points[i] ?? 18));
  });
  return need.map((room) => (room <= LIST_INDENT ? LIST_INDENT : Math.min(MOST_HANGING, Math.ceil(room / HANG_STEP) * HANG_STEP)));
}

/** Where a paragraph's lines start, in slide units from the box's inset. */
export interface Geometry {
  /** Where the lines after the first start (for a list item, where its words start). */
  margin: number;
  /** Where the first line starts, from `margin`; negative for a marker that hangs out to the left. */
  indent: number;
}

/**
 * Where each paragraph sets its lines. A list item hangs its marker in the room its
 * level needs and sits under the words of the level above; a paragraph that is not
 * one moves in `LIST_STEP` for each level. A paragraph's own `marginLeft` and
 * `indent` win, and neither puts a line outside the box.
 */
export function layoutParagraphs(paragraphs: readonly Listed[], points: readonly number[]): Geometry[] {
  const hangs = hangsByLevel(paragraphs, points);
  return paragraphs.map((p) => {
    const at = levelOf(p);
    const listed = p.list === "bullet" || p.list === "number";
    const wanted = p.marginLeft;
    const base = listed ? hangs.slice(0, at + 1).reduce((sum, hang) => sum + hang, 0) : LIST_STEP * at;
    let margin = typeof wanted === "number" ? wanted : base;
    margin = Number.isFinite(margin) ? Math.max(0, margin) : 0;
    const first = p.indent;
    let indent = typeof first === "number" ? first : listed ? -(hangs[at] ?? LIST_INDENT) : 0;
    indent = Number.isFinite(indent) ? Math.max(-margin, indent) : 0;
    return { margin, indent };
  });
}
