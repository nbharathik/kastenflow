// Pasted content, read down to what slide text keeps: paragraphs, list items
// (their kind, style and where they count from), and bold, italic, underline,
// strike, links, colour, size, code and raised or lowered words. A face of
// wherever it came from is left behind, and so is any size that is only the
// source's own body size, so words do not land at the size of a page.

import type { ListKind, ListStyle, Script } from "@kasten-slides/wasm";

import { safeLink } from "./links.ts";
import { MAX_LEVEL, listNumbers } from "./lists.ts";

/** A stretch of pasted words with the few looks that are kept. */
export interface PastedRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  link: string | null;
  /** A colour as `#rrggbb`; null for the page's own, which is not carried over. */
  color?: string | null;
  /** The size in points it had where it came from. */
  size?: number | null;
  code?: boolean;
  script?: Script | null;
  /** A line break made by `<br>`, which is dropped at the end of a paragraph. */
  lineBreak?: boolean;
}

export interface PastedParagraph {
  list: ListKind | null;
  level: number;
  runs: PastedRun[];
  listStyle?: ListStyle | null;
  /** The number a numbered item counts from, when the list does not begin at 1. */
  start?: number | null;
}

const plain = (text: string): PastedRun => ({ text, bold: false, italic: false, underline: false, strike: false, link: null });

/** Plain text: a paragraph for each line. */
export function parseText(text: string): PastedParagraph[] {
  return text.split(/\r\n|\r|\n/).map((line) => ({ list: null, level: 0, runs: line === "" ? [] : [plain(line)] }));
}

const MARKED = /^(\s*)([-*+•●○■▪–]|\d{1,4}[.)]|[a-z][.)])\s+(\S.*)$/;

/**
 * Plain text with a list in it: a line that starts with `- `, `* `, `• `, `1. ` or `a) ` is an item, nested
 * one level for each two spaces (or a tab) in front of it. Text with no such line is just lines.
 */
export function parseTextWithLists(text: string): PastedParagraph[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (!lines.some((line) => MARKED.test(line))) return parseText(text);
  const typed: (number | null)[] = [];
  const found = lines.map((line): PastedParagraph => {
    const marked = MARKED.exec(line);
    if (!marked) {
      typed.push(null);
      return { list: null, level: 0, runs: line === "" ? [] : [plain(line.trim() === "" ? "" : line)] };
    }
    const indent = (marked[1] ?? "").replace(/\t/g, "  ").length;
    const marker = marked[2] ?? "";
    const numbered = /[0-9a-z]/.test(marker.charAt(0));
    const letter = /^[a-z]/.test(marker);
    typed.push(numbered ? Math.max(1, letter ? marker.charCodeAt(0) - 96 : Number.parseInt(marker, 10)) : null);
    return {
      list: numbered ? "number" : "bullet",
      level: Math.min(MAX_LEVEL, Math.floor(indent / 2)),
      runs: [plain(marked[3] ?? "")],
      listStyle: numbered ? (letter ? "lowerAlpha" : marker.endsWith(")") ? "decimalParen" : null) : null,
      start: null,
    };
  });
  return reconcileStarts(found, typed);
}

/**
 * Tells the numbered items that would not count to the number they were written with where to
 * begin, so a list written `3. 4. 5.` begins at 3 once and a list that begins again says so.
 */
function reconcileStarts(paragraphs: PastedParagraph[], typed: readonly (number | null)[]): PastedParagraph[] {
  // A paste is a few lines; a very long one is left as it is rather than counted over and over.
  if (paragraphs.length > 400) return paragraphs;
  for (let pass = 0; pass < paragraphs.length; pass++) {
    const ours = listNumbers(paragraphs);
    const at = typed.findIndex((n, i) => n !== null && ours[i] !== n);
    if (at < 0) break;
    const item = paragraphs[at];
    if (item) item.start = typed[at] ?? null;
  }
  return paragraphs;
}

const IGNORED = new Set(["script", "style", "head", "title", "meta", "link", "template", "noscript", "iframe", "object", "embed", "svg", "canvas", "audio", "video", "img", "picture", "input", "select", "textarea"]);

const BLOCKS = new Set(["p", "div", "section", "article", "header", "footer", "aside", "nav", "main", "address", "figure", "figcaption", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "hr", "fieldset", "form", "details", "summary"]);

interface Look {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  link: string | null;
  color: string | null;
  size: number | null;
  code: boolean;
  script: Script | null;
  /** Spaces and line ends are kept as they are. */
  pre: boolean;
}

/** The declarations of an element's `style` attribute, names in lower case. */
function declarations(element: Element): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of (element.getAttribute("style") ?? "").split(";")) {
    const colon = part.indexOf(":");
    if (colon > 0) found.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim().toLowerCase());
  }
  return found;
}

/** A colour as `#rrggbb`, from `#rgb`, `#rrggbb` or `rgb(r, g, b)`; null for anything else. */
export function hexOfCss(value: string): string | null {
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb && (rgb[4] === undefined || Number.parseFloat(rgb[4]) > 0)) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

/** Whether a colour is what text is set in by default (near black or near white, with no tint): that is the page's, not a choice. */
export function isDefaultInk(hex: string): boolean {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const [r = 0, g = 0, b = 0] = channels;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return spread < 24 && (Math.max(r, g, b) < 0x50 || Math.min(r, g, b) > 0xc8);
}

/** A size in points from `12pt` or `16px`; null for any other (`1.2em`, `larger`). */
export function pointsOfCss(value: string): number | null {
  const found = /^([\d.]+)(pt|px)$/.exec(value.trim().toLowerCase());
  if (!found) return null;
  const n = Number.parseFloat(found[1] ?? "");
  const points = found[2] === "px" ? n * 0.75 : n;
  return Number.isFinite(points) && points > 0 ? points : null;
}

/** The look inside an element: the look outside it, changed by its tag and its style. */
function lookOf(element: Element, outside: Look): Look {
  const tag = element.tagName.toLowerCase();
  const look = { ...outside };
  if (tag === "b" || tag === "strong") look.bold = true;
  if (tag === "i" || tag === "em" || tag === "cite" || tag === "dfn" || tag === "var") look.italic = true;
  if (tag === "u" || tag === "ins") look.underline = true;
  if (tag === "s" || tag === "strike" || tag === "del") look.strike = true;
  if (tag === "code" || tag === "tt" || tag === "kbd" || tag === "samp") look.code = true;
  if (tag === "sup") look.script = "super";
  if (tag === "sub") look.script = "sub";
  if (tag === "pre") look.pre = true;
  if (tag === "a") look.link = safeLink(element.getAttribute("href")) ?? look.link;
  // A style wins over its tag: Google Docs wraps what it copies in a `b` whose weight is normal.
  const style = declarations(element);
  const weight = style.get("font-weight");
  if (weight) look.bold = weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  const slant = style.get("font-style");
  if (slant) look.italic = slant === "italic" || slant.startsWith("oblique");
  const lines = `${style.get("text-decoration-line") ?? ""} ${style.get("text-decoration") ?? ""}`;
  if (lines.includes("underline")) look.underline = true;
  if (lines.includes("line-through")) look.strike = true;
  if ((style.get("white-space") ?? "").startsWith("pre")) look.pre = true;
  const align = style.get("vertical-align");
  if (align === "super") look.script = "super";
  else if (align === "sub") look.script = "sub";
  else if (align === "baseline") look.script = null;
  const color = style.get("color");
  if (color) {
    const hex = hexOfCss(color);
    look.color = hex !== null && !isDefaultInk(hex) ? hex : null;
  }
  const size = pointsOfCss(style.get("font-size") ?? "");
  if (size !== null) look.size = size;
  const family = style.get("font-family") ?? "";
  if (/mono|courier|consolas|menlo|monaco/.test(family)) look.code = true;
  return look;
}

/** The list a `ul` or `ol` is, with how its items are marked and where they count from. */
function listOf(element: Element): { kind: ListKind; style: ListStyle | null; start: number | null } {
  const tag = element.tagName.toLowerCase();
  const declared = declarations(element).get("list-style-type") ?? element.getAttribute("type") ?? "";
  const kind: ListKind = tag === "ol" ? "number" : "bullet";
  const styles: Record<string, ListStyle> = {
    disc: "disc",
    circle: "circle",
    square: "square",
    decimal: "decimal",
    "1": "decimal",
    "lower-alpha": "lowerAlpha",
    "lower-latin": "lowerAlpha",
    a: "lowerAlpha",
    "upper-alpha": "upperAlpha",
    "upper-latin": "upperAlpha",
    A: "upperAlpha",
    "lower-roman": "lowerRoman",
    i: "lowerRoman",
    "upper-roman": "upperRoman",
    I: "upperRoman",
  };
  const style = styles[declared.trim()] ?? styles[declared.trim().toLowerCase()] ?? null;
  const start = tag === "ol" ? Number.parseInt(element.getAttribute("start") ?? "", 10) : Number.NaN;
  return { kind, style: style !== null && kindOfListStyle(style) === kind ? style : null, start: Number.isFinite(start) && start !== 1 && start > 0 ? start : null };
}

const kindOfListStyle = (style: ListStyle): ListKind => (["disc", "circle", "square", "arrow", "check", "dash"].includes(style) ? "bullet" : "number");

interface Item {
  list: ListKind;
  level: number;
  style: ListStyle | null;
  start: number | null;
}

/** Collects paragraphs as the page is walked. */
class Collector {
  readonly paragraphs: PastedParagraph[] = [];
  private current: PastedParagraph | null = null;
  private item: Item | null = null;

  /** The next paragraph collected is a list item. */
  startItem(item: Item): void {
    this.end();
    this.item = { ...item, level: Math.min(MAX_LEVEL, Math.max(0, item.level)) };
  }

  endItem(): void {
    this.end();
    this.item = null;
  }

  add(text: string, look: Look): void {
    // A no-break space (U+00A0) in the pasted words is a space in the text.
    // eslint-disable-next-line no-irregular-whitespace
    const shown = look.pre ? text : this.collapse(text).replace(/ /g, " ");
    if (shown === "") return;
    this.open().runs.push(this.run(shown, look));
  }

  lineBreak(look: Look): void {
    this.open().runs.push({ ...this.run("\n", look), lineBreak: true });
  }

  private run(text: string, look: Look): PastedRun {
    return { text, bold: look.bold, italic: look.italic, underline: look.underline, strike: look.strike, link: look.link, color: look.color, size: look.size, code: look.code, script: look.script };
  }

  /** Makes sure there is a paragraph to end, so that a line with nothing on it is an empty paragraph. */
  blank(): void {
    this.open();
  }

  /** Runs of white space are one space, and there is none at the start of a paragraph. */
  private collapse(text: string): string {
    const spaced = text.replace(/[ \t\r\n\f]+/g, " ");
    const last = this.current?.runs[this.current.runs.length - 1];
    const atStart = last === undefined || last.lineBreak === true || last.text.endsWith(" ");
    return atStart ? spaced.replace(/^ /, "") : spaced;
  }

  private open(): PastedParagraph {
    if (!this.current) {
      const item = this.item;
      this.current = { list: item?.list ?? null, level: item?.level ?? 0, runs: [], listStyle: item?.style ?? null, start: item?.start ?? null };
      this.item = null;
    }
    return this.current;
  }

  /** Ends the paragraph being collected. A last line break and last spaces are not kept. */
  end(): void {
    const paragraph = this.current;
    this.current = null;
    if (!paragraph) return;
    const runs = paragraph.runs;
    if (runs[runs.length - 1]?.lineBreak) runs.pop();
    const last = runs[runs.length - 1];
    if (last) {
      last.text = last.text.replace(/ +$/, "");
      if (last.text === "") runs.pop();
    }
    this.paragraphs.push(paragraph);
  }
}

/** Text in preformatted content: each line is a paragraph, and a line with nothing on it an empty one. */
function addPreformatted(text: string, look: Look, out: Collector): void {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, index) => {
    if (index > 0) out.end();
    if (line !== "") out.add(line, look);
    else if (index < lines.length - 1 || lines.length === 1) out.blank();
  });
}

interface Nesting {
  lists: readonly ReturnType<typeof listOf>[];
  /** How many items of the innermost list have been seen, to say which of them begins it. */
  seen: Map<Element, number>;
}

function walk(node: Node, look: Look, nesting: Nesting, out: Collector): void {
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? "";
    if (look.pre) addPreformatted(text, look, out);
    else out.add(text, look);
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (IGNORED.has(tag)) return;
  if (tag === "br") {
    out.lineBreak(look);
    return;
  }
  const inside = lookOf(element, look);
  const isList = tag === "ul" || tag === "ol";
  const lists = isList ? [...nesting.lists, listOf(element)] : nesting.lists;
  if (tag === "li") {
    const owner = element.parentElement;
    const list = nesting.lists[nesting.lists.length - 1];
    const first = owner !== null && !nesting.seen.has(owner);
    if (owner) nesting.seen.set(owner, (nesting.seen.get(owner) ?? 0) + 1);
    // Where a numbered list begins counting is said by its first item.
    out.startItem({ list: list?.kind ?? "bullet", level: Math.max(0, nesting.lists.length - 1), style: list?.style ?? null, start: first ? (list?.start ?? null) : null });
  } else if (BLOCKS.has(tag)) out.end();
  else if ((tag === "td" || tag === "th") && element.previousElementSibling) out.add("\t", { ...inside, pre: true });
  for (const child of Array.from(element.childNodes)) walk(child, inside, { lists, seen: nesting.seen }, out);
  if (tag === "li") out.endItem();
  else if (BLOCKS.has(tag)) out.end();
}

/** The paragraphs in a piece of HTML. */
export function parseHtml(html: string): PastedParagraph[] {
  const page = new DOMParser().parseFromString(html, "text/html");
  const out = new Collector();
  walk(page.body, { bold: false, italic: false, underline: false, strike: false, link: null, color: null, size: null, code: false, script: null, pre: false }, { lists: [], seen: new Map() }, out);
  out.end();
  return out.paragraphs;
}

/** Whether any paragraph has words. */
export const hasWords = (paragraphs: readonly PastedParagraph[]): boolean => paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim() !== ""));

/**
 * The size words land at: the one most of the words had where they came from is the
 * source's own body size and is not carried over; any other is kept in proportion to it,
 * from `landing` (the size at the caret), between half and three times that.
 */
export function sizesFor(paragraphs: readonly PastedParagraph[], landing: number): (run: PastedRun) => number | null {
  const weight = new Map<number, number>();
  for (const paragraph of paragraphs) {
    for (const run of paragraph.runs) if (typeof run.size === "number") weight.set(run.size, (weight.get(run.size) ?? 0) + run.text.length);
  }
  let base: number | null = null;
  let most = 0;
  for (const [size, count] of weight) {
    if (count > most) {
      most = count;
      base = size;
    }
  }
  return (run) => {
    if (typeof run.size !== "number" || base === null || Math.abs(run.size - base) < 0.5) return null;
    const scaled = landing * (run.size / base);
    return Math.round(Math.min(landing * 3, Math.max(landing / 2, scaled)) * 2) / 2;
  };
}
