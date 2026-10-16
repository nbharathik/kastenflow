// The page editor's words as plain text, cut into sections, with where each
// character is in the document: what comments and highlights are placed in
// (anchor.ts reads the text; this finds the document positions back).
//
// Text blocks are separated by a line break, a link is the words it shows and
// a picture or other leaf is a space; a divider cuts the page into sections as
// it does everywhere else (editor/sections/model.ts), and a section's title is
// the one the fold state and the section strip use.

import type { Node } from "@milkdown/kit/prose/model";

import { parseWikiTarget } from "../pages/editor/links";
import { sectionsOf, sectionTitle } from "../pages/editor/sections/model";
import { pageTextOf, type PageSection, type PageText, type Range } from "./anchor";

/** The page's plain text, and where each of its characters is in the document. */
export interface EditorText extends PageText {
  /** The document position of each character of `full`; a line break stands where its block begins. */
  pos: readonly number[];
}

/** What an inline leaf shows as text. */
function leafText(node: Node): string {
  if (node.type.name === "wiki_link") {
    const target = parseWikiTarget(String(node.attrs.value));
    return target.alias || target.title;
  }
  return node.type.name === "math_inline" ? String(node.attrs.value) : " ";
}

/** The first index of `pos` (which only rises) at or after `at`. */
function lowerBound(pos: readonly number[], at: number): number {
  let low = 0;
  let high = pos.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (pos[mid]! < at) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** A document is never changed, so its text is read once, however often it is asked for. */
const read = new WeakMap<Node, EditorText>();

export function editorText(doc: Node): EditorText {
  let text = read.get(doc);
  if (!text) {
    text = readText(doc);
    read.set(doc, text);
  }
  return text;
}

function readText(doc: Node): EditorText {
  let flat = "";
  const where: number[] = [];
  doc.descendants((node, at) => {
    if (node.isText) {
      const text = node.text ?? "";
      flat += text;
      for (let i = 0; i < text.length; i++) where.push(at + i);
      return false;
    }
    if (node.isInline && node.isLeaf) {
      const text = leafText(node);
      flat += text;
      for (let i = 0; i < text.length; i++) where.push(at);
      return false;
    }
    if (node.isTextblock && flat !== "") {
      flat += "\n";
      where.push(at);
    }
    return true;
  });
  const parts: PageSection[] = [];
  const pos: number[] = [];
  sectionsOf(doc).forEach((section, index) => {
    let from = lowerBound(where, section.from);
    const to = lowerBound(where, section.to);
    // The line break before a section's first block belongs to no section.
    if (from < to && flat[from] === "\n") from++;
    if (index > 0) pos.push(section.divider ?? section.from);
    for (let i = from; i < to; i++) pos.push(where[i]!);
    parts.push({ title: sectionTitle(doc, section), text: flat.slice(from, to) });
  });
  return { ...pageTextOf(parts), pos };
}

/** The part of the page's text that the document positions `from` to `to` cover. */
export function offsetsOf(text: EditorText, from: number, to: number): Range {
  return { from: lowerBound(text.pos, from), to: lowerBound(text.pos, to) };
}

/** The document positions that a stretch of the page's text covers, or null when it covers none. */
export function positionsOf(text: EditorText, range: Range): { from: number; to: number } | null {
  if (range.to <= range.from || range.from < 0 || range.to > text.pos.length) return null;
  return { from: text.pos[range.from]!, to: text.pos[range.to - 1]! + 1 };
}
