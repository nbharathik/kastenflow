// Change case: the selected words in capitals, in lower case, with each word
// capitalised, or with a capital at the start of each sentence. The words keep
// their looks, and a caret with nothing selected takes the word it is in.

import type { Mark } from "prosemirror-model";

import type { Command } from "./mark-commands.ts";
import { wordAt } from "./selection-info.ts";

export type CaseMode = "upper" | "lower" | "title" | "sentence";

/** One code point at a time, so the text keeps its length: a letter that would become two stays as it is. */
function mapped(text: string, change: (char: string) => string): string {
  let out = "";
  for (const char of text) {
    const next = change(char);
    out += next.length === char.length ? next : char;
  }
  return out;
}

/** `text` in `mode`. `before` is the text just before it, which says whether it starts a word or a sentence. */
export function convertCase(text: string, mode: CaseMode, before = ""): string {
  if (mode === "upper") return mapped(text, (c) => c.toUpperCase());
  const lower = mapped(text, (c) => c.toLowerCase());
  if (mode === "lower") return lower;
  const started = /\S/.test(before);
  let out = "";
  // The few characters before the next one, as they read after the change: they say whether it starts a word or a sentence.
  let context = before.slice(-8);
  for (const char of lower) {
    const startsWord = context === "" || /[\s"'“‘([{\-/–—]$/.test(context);
    const startsSentence = (!started && /^\s*$/.test(out + context)) || /[.!?…]["')\]”’]*\s+$/.test(context);
    const capital = mode === "title" ? startsWord : startsSentence;
    const shown = capital && /\p{L}/u.test(char) ? mapped(char, (c) => c.toUpperCase()) : char;
    out += shown;
    context = (context + shown).slice(-8);
  }
  return out;
}

/** Changes the case of the selected words, or of the word the caret is in. */
export function changeCase(mode: CaseMode): Command {
  return (state, dispatch) => {
    const ranges: { from: number; to: number }[] = [];
    for (const { $from, $to } of state.selection.ranges) {
      if ($from.pos !== $to.pos) ranges.push({ from: $from.pos, to: $to.pos });
      else {
        const word = wordAt(state, $from.pos);
        if (word) ranges.push(word);
      }
    }
    if (ranges.length === 0) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (const { from, to } of ranges) {
      const pieces: { pos: number; text: string; marks: readonly Mark[]; paragraphStart: number }[] = [];
      state.doc.nodesBetween(from, to, (node, pos, parent) => {
        if (!node.isText || !node.text || !parent) return true;
        const start = Math.max(from, pos);
        const end = Math.min(to, pos + node.nodeSize);
        if (start < end) pieces.push({ pos: start, text: node.text.slice(start - pos, end - pos), marks: node.marks, paragraphStart: state.doc.resolve(pos).start() });
        return true;
      });
      let before = "";
      const first = pieces[0];
      if (first) before = state.doc.textBetween(first.paragraphStart, first.pos, undefined, "\u0000");
      for (const piece of pieces) {
        const next = convertCase(piece.text, mode, before);
        if (next !== piece.text) tr.replaceWith(piece.pos, piece.pos + piece.text.length, state.schema.text(next, piece.marks));
        // What comes before the next piece is this one as it now reads.
        before += next;
      }
    }
    if (tr.docChanged) dispatch(tr);
    return true;
  };
}
