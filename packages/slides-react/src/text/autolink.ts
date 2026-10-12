// An address typed and followed by a space or Enter becomes a link, as in
// Google Slides: `https://example.com`, `www.example.com` and `me@example.com`.

import type { EditorState } from "prosemirror-state";

import { safeLink } from "./links.ts";

/** The address a typed word stands for, and how much of the word it is: trailing punctuation is not part of it. */
export function addressIn(word: string): { href: string; length: number } | null {
  let end = word.length;
  // Sentence punctuation, and a closing bracket that nothing in the word opened.
  while (end > 0) {
    const last = word.charAt(end - 1);
    if (/[.,;:!?'"”’»>\]}]/.test(last)) end -= 1;
    else if (last === ")" && !word.slice(0, end).includes("(")) end -= 1;
    else break;
  }
  const body = word.slice(0, end);
  if (/^https?:\/\/[^\s/?#]+\.[^\s/?#]{2,}/i.test(body) || /^https?:\/\/localhost(:\d+)?([/?#]|$)/i.test(body)) {
    const href = safeLink(body);
    return href === null ? null : { href, length: end };
  }
  if (/^www\.[^\s/?#]+\.[^\s/?#]{2,}/i.test(body)) {
    const href = safeLink(`https://${body}`);
    return href === null ? null : { href, length: end };
  }
  if (/^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i.test(body)) {
    const href = safeLink(`mailto:${body}`);
    return href === null ? null : { href, length: end };
  }
  return null;
}

/**
 * The address just before the caret that should become a link: the word the caret
 * follows, when it is an address that is not a link yet. `from` and `to` are the
 * address itself, without any punctuation after it.
 */
export function addressBeforeCaret(state: EditorState): { from: number; to: number; href: string } | null {
  const { selection, schema } = state;
  const type = schema.marks.link;
  if (!type || !selection.empty) return null;
  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph") return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\u0000");
  const word = /(\S+)$/.exec(before)?.[1];
  if (word === undefined) return null;
  const found = addressIn(word);
  if (!found) return null;
  const from = $from.start() + before.length - word.length;
  const to = from + found.length;
  // Words that already are links, or are code, are left as they are.
  if (state.doc.rangeHasMark(from, to, type) || state.doc.rangeHasMark(from, to, schema.marks.code ?? type)) return null;
  return { from, to, href: found.href };
}
