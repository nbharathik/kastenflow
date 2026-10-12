// What a copy of blocks or slides puts on the clipboard, and how a paste reads it back. A copy carries the same JSON three ways, so that a
// paste finds it wherever the clipboard has been (another deck, another window, a webview that keeps only the standard types):
//   a type only Kasten reads         (the copy and cut events set it; the browser keeps it with the rest)
//   a hidden attribute in the HTML   (a copy from a menu, which can only write the standard types)
//   the words as plain text          (what any other program gets, so a paste into a note or a mail is the words, not JSON)
// What the first versions wrote, `kasten-slides:` and JSON as plain text, is still read.

import type { Element, Slide } from "@kasten-slides/wasm";

import { pictureFiles } from "../gallery/drag.ts";
import type { Box } from "../session/types.ts";

/** The clipboard type only Kasten reads. */
export const KASTEN_TYPE = "application/x-kasten-slides";
/** The attribute that carries the JSON inside the HTML of a copy. */
const ATTRIBUTE = "data-kasten-slides";
/** What the first versions put in front of the JSON in the plain text of a copy. */
const LEGACY = "kasten-slides:";

/** Elements copied from a slide. */
export interface ElementsClip {
  v: 2;
  kind: "elements";
  /** Names this copy, so that pastes of it are counted and each steps further from the one before it. */
  stamp: string;
  elements: Element[];
  /** The slide they were copied from. */
  from: string;
  /** Cut, not copied: they are gone from there, so the first paste puts them back exactly where they were. */
  cut: boolean;
}

/** Slides copied from a deck. */
export interface SlidesClip {
  v: 2;
  kind: "slides";
  stamp: string;
  slides: Slide[];
  /** The sections that begin at one of these slides: the title, and the slide's id. */
  sections: { title: string; startsAt: string }[];
  /** Where the elements that take their place from a layout were (by slide id, then element id), for a deck that has no such layout. */
  pins: Record<string, Record<string, Box>>;
  cut: boolean;
}

export type Clip = ElementsClip | SlidesClip;

/** What a paste finds on the clipboard, however it was read. */
export interface ClipContents {
  /** What Kasten copied, when that is what is there. */
  clip: Clip | null;
  text: string;
  html: string;
  /** The pictures: screenshots, copied images, files. */
  files: File[];
}

export const EMPTY: ClipContents = { clip: null, text: "", html: "", files: [] };

/** The part of a clipboard event's data that is used, so that tests need no real `DataTransfer`. */
export interface DataLike {
  getData(type: string): string;
  setData?(type: string, value: string): void;
  files?: ArrayLike<File> | null;
}

/** A new name for a copy. */
export const newStamp = (): string => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ---- the JSON, as text that can sit in an attribute

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): string {
  const binary = atob(text);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** A clip as the JSON the Kasten type carries. */
export const encode = (clip: Clip): string => JSON.stringify(clip);

/** A clip from JSON, if it is one: right kind, right version, something in it. Anything else is not ours. */
export function decode(json: string | undefined | null): Clip | null {
  if (!json) return null;
  try {
    const found = JSON.parse(json) as { v?: number; kind?: string; stamp?: unknown; elements?: unknown; slides?: unknown; sections?: unknown; pins?: unknown } | null;
    if (!found || found.v !== 2 || typeof found.stamp !== "string") return null;
    if (found.kind === "elements" && Array.isArray(found.elements) && found.elements.length > 0) return found as unknown as ElementsClip;
    if (found.kind === "slides" && Array.isArray(found.slides) && found.slides.length > 0) return { ...found, sections: found.sections ?? [], pins: found.pins ?? {} } as unknown as SlidesClip;
    return null;
  } catch {
    return null;
  }
}

/** The elements a copy of the first versions made, in the plain text it wrote; null when the text is anything else. */
export function legacy(text: string | undefined | null): ElementsClip | null {
  if (!text?.startsWith(LEGACY)) return null;
  try {
    const parsed = JSON.parse(text.slice(LEGACY.length)) as { v?: number; elements?: Element[] };
    if (parsed.v !== 1 || !Array.isArray(parsed.elements) || parsed.elements.length === 0) return null;
    return { v: 2, kind: "elements", stamp: "legacy", elements: parsed.elements, from: "", cut: false };
  } catch {
    return null;
  }
}

// ---- the words, and the HTML that carries the JSON

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The HTML of a copy: the words as paragraphs, with the JSON in an attribute where nobody sees it. */
export function htmlOf(clip: Clip, words: string): string {
  const lines = words.split("\n").map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`);
  return `<div ${ATTRIBUTE}="${toBase64(encode(clip))}">${lines.join("")}</div>`;
}

/** The clip an HTML copy carries, if it is one of ours. */
export function fromHtml(html: string | undefined | null): Clip | null {
  const found = html ? new RegExp(`${ATTRIBUTE}="([A-Za-z0-9+/=]+)"`).exec(html)?.[1] : undefined;
  if (!found) return null;
  try {
    return decode(fromBase64(found));
  } catch {
    return null;
  }
}

/** The words of HTML from elsewhere: its text, one block to a line. */
export function wordsOfHtml(html: string): string {
  if (!html.trim()) return "";
  const body = new DOMParser().parseFromString(html, "text/html").body;
  body.querySelectorAll("script, style, template").forEach((node) => node.remove());
  const lines: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + (node.textContent ?? "").replace(/\s+/g, " ");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const block = /^(P|DIV|LI|H[1-6]|TR|BLOCKQUOTE|PRE|UL|OL|TABLE|SECTION|ARTICLE)$/.test(node.tagName);
    if (node.tagName === "BR" || block) lines.push("");
    node.childNodes.forEach(walk);
    if (block) lines.push("");
  };
  lines.push("");
  body.childNodes.forEach(walk);
  // One paragraph to a block: the empty lines between blocks are only where one ended and the next began.
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** The pictures an HTML paste holds that are in it as data (a copied image): files, in order. Pictures it only links to cannot be fetched here. */
export function picturesOfHtml(html: string): File[] {
  const files: File[] = [];
  for (const [at, match] of [...html.matchAll(/<img\b[^>]*?\bsrc=["']data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)["']/gi)].entries()) {
    try {
      const bytes = Uint8Array.from(atob(match[2]!), (char) => char.charCodeAt(0));
      const type = match[1]!.toLowerCase();
      files.push(new File([bytes], `image-${at + 1}.${type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+.*$/, "") || "png"}`, { type }));
    } catch {
      // Not a picture that can be read.
    }
  }
  return files;
}

// ---- reading and writing a clipboard event's data

/** What a paste event carries. */
export function contentsOf(data: DataLike | null | undefined): ClipContents {
  if (!data) return EMPTY;
  const html = data.getData("text/html") ?? "";
  const text = data.getData("text/plain") ?? "";
  const clip = decode(data.getData(KASTEN_TYPE)) ?? fromHtml(html) ?? legacy(text);
  return { clip, text, html, files: pictureFiles(Array.from(data.files ?? [])) };
}

/** Puts a copy on a copy or cut event's data: the three carriers, and `text/plain` for everyone else. */
export function writeTo(data: Required<Pick<DataLike, "setData">>, clip: Clip, words: string): void {
  data.setData(KASTEN_TYPE, encode(clip));
  data.setData("text/html", htmlOf(clip, words));
  data.setData("text/plain", words);
}
