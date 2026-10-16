// What an answer is asked with, and where a taken answer goes. The page is
// sent as the person sees it: the selection as Markdown, so its formatting
// can come back, and a little plain text on each side. A taken answer goes
// in as one change, which one undo takes back.

import type { Fragment, Node } from "@milkdown/kit/prose/model";
import { Slice } from "@milkdown/kit/prose/model";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";

import type { ExplainScope, WriteAction } from "../../../chat/types";
import type { AiRange } from "./ai";
import { blockEnd } from "./ai";

/** The characters of plain text sent from each side. */
export const AROUND = 2_000;

export interface PageText {
  selection: string;
  before: string;
  after: string;
}

/** Markdown without the `<br />` lines the editor writes for empty
 * paragraphs, which say nothing to a model. */
function withoutBlankLines(markdown: string): string {
  return markdown
    .replace(/^[ \t]*<br\s*\/?>[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The page around `range`, for `action`; `serialize` writes Markdown. Explain
 * with the whole-page `scope` sends all the text on each side; the
 * backend cuts it to fit. */
export function pageText(doc: Node, action: WriteAction, range: AiRange, serialize: (doc: Node) => string, scope: ExplainScope = "nearby"): PageText {
  const before = doc.textBetween(0, range.from, "\n\n", " ");
  const after = doc.textBetween(range.to, doc.content.size, "\n\n", " ");
  const selection = action === "summarize" ? serialize(doc) : range.to > range.from ? serialize(doc.cut(range.from, range.to)) : "";
  const whole = action === "explain" && scope === "page";
  return { selection: withoutBlankLines(selection), before: whole ? before : before.slice(-AROUND), after: whole ? after : after.slice(0, AROUND) };
}

/** The whole page as Markdown, without the blank lines the editor writes. */
export function wholePage(doc: Node, serialize: (doc: Node) => string): string {
  return withoutBlankLines(serialize(doc));
}

/** The answer without a code fence around the whole of it, which models
 * add now and then though asked not to. */
export function cleanAnswer(text: string): string {
  const fenced = /^\s*```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```\s*$/i.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

export type Placing = "replace" | "below";

/** Puts `content` in the page: in place of the range ("replace"), or after
 * its block ("below"); an empty block at the caret is filled instead. */
export function placeAnswer(state: EditorState, content: Fragment, range: AiRange, how: Placing): Transaction {
  const tr = state.tr;
  let end: number;
  if (how === "replace" && range.to > range.from) {
    const first = content.firstChild;
    // One paragraph joins the text around it; blocks stand on their own.
    const inline = content.childCount === 1 && first?.type.name === "paragraph";
    tr.replaceRange(range.from, range.to, new Slice(content, inline ? 1 : 0, inline ? 1 : 0));
    end = tr.mapping.map(range.to, 1);
  } else {
    const $at = state.doc.resolve(range.to);
    const block = $at.depth >= 1 ? $at.node(1) : null;
    if (range.to === range.from && block?.isTextblock && block.content.size === 0) {
      tr.replaceWith($at.before(1), $at.after(1), content);
      end = $at.before(1) + content.size;
    } else {
      const at = blockEnd(state, range.to);
      tr.insert(at, content);
      end = at + content.size;
    }
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
  return tr.scrollIntoView();
}
