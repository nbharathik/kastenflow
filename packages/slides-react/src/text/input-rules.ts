// What typing a space at the start of a paragraph does: `- ` and `* ` make a
// bullet item, `1. ` and `a. ` a numbered one, as Markdown habits and Google
// Slides do.

import type { ListStyle } from "@kasten-slides/wasm";
import { closeHistory } from "prosemirror-history";
import type { EditorState, Transaction } from "prosemirror-state";

import { attrsOf } from "./schema.ts";

const BULLET = /^[-*+•]$/;
const NUMBER = /^(\d{1,4})([.)])$/;
const LETTER = /^([a-z])([.)])$/;

/** The list a marker typed at the start of a paragraph stands for, or null when it is not one. */
export function listOfMarker(typed: string): { kind: "bullet" | "number"; style: ListStyle; start: number | null } | null {
  if (BULLET.test(typed)) return { kind: "bullet", style: "disc", start: null };
  const number = NUMBER.exec(typed);
  if (number) {
    const at = Number(number[1]);
    return { kind: "number", style: number[2] === ")" ? "decimalParen" : "decimal", start: at === 1 ? null : at };
  }
  const letter = LETTER.exec(typed);
  if (letter) {
    const char = letter[1] ?? "a";
    // `i.` is a Roman numeral; any other letter counts as the letters do.
    if (char === "i") return { kind: "number", style: "lowerRoman", start: null };
    const at = char.charCodeAt(0) - 96;
    return { kind: "number", style: "lowerAlpha", start: at === 1 ? null : at };
  }
  return null;
}

/**
 * The change a space typed at `from` makes: the marker typed before it is
 * removed and the paragraph becomes a list item. It is its own step of local
 * undo, so undoing it gives the marker back. Null when the space is just a space.
 */
export function listRule(state: EditorState, from: number, to: number, text: string): Transaction | null {
  if (text !== " " || from !== to) return null;
  const $from = state.doc.resolve(from);
  const paragraph = $from.parent;
  if (paragraph.type.name !== "paragraph" || attrsOf(paragraph).list) return null;
  const typed = paragraph.textBetween(0, $from.parentOffset);
  const found = listOfMarker(typed);
  if (!found) return null;
  const tr = closeHistory(state.tr);
  tr.delete($from.start(), from);
  tr.setNodeMarkup($from.before(), undefined, { ...paragraph.attrs, list: found.kind, listStyle: found.style === "disc" || found.style === "decimal" ? null : found.style, start: found.start, marginLeft: null, indent: null });
  return tr;
}
