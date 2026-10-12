// What the editor corrects as words are typed, as Google Slides does: `--` is an
// en dash, a third `-` an em dash, `...` an ellipsis, `(c)` a copyright sign,
// `->` an arrow, quotes are curly, `:smile:` an emoji, and an address followed
// by a space is a link. Each correction is its own step of local undo, so one
// undo gives back what was typed. Inline code is left as typed.

import { closeHistory } from "prosemirror-history";
import type { Mark } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

import { addressBeforeCaret } from "./autolink.ts";
import { EMOJI } from "./emoji.ts";
import { listRule } from "./input-rules.ts";
import type { TextPrefs } from "./prefs.ts";
import { caretMarks } from "./selection-info.ts";

/** What a character typed at the end of `before` turns into, and how much of `before` it takes with it. */
export interface Substitution {
  /** How many characters before the caret are replaced. */
  take: number;
  put: string;
}

const OPENS = /[\s([{<—–\-/]$/;

/** The sign a typed character stands for given the words before it, or null when it is just the character. */
export function substitution(before: string, typed: string, prefs: Pick<TextPrefs, "autocorrect" | "smartQuotes">): Substitution | null {
  if (prefs.smartQuotes) {
    const open = before === "" || OPENS.test(before) || /[“‘]$/.test(before);
    if (typed === '"') return { take: 0, put: open ? "“" : "”" };
    if (typed === "'") return { take: 0, put: open ? "‘" : "’" };
  }
  if (!prefs.autocorrect) return null;
  if (typed === "-") {
    if (before.endsWith("–")) return { take: 1, put: "—" };
    if (before.endsWith("-") && !before.endsWith("--")) return { take: 1, put: "–" };
  }
  if (typed === "." && before.endsWith("..") && !before.endsWith("...")) return { take: 2, put: "…" };
  if (typed === ">") {
    if (before.endsWith("-") && !before.endsWith("--")) return { take: 1, put: "→" };
    if (before.endsWith("=") && !before.endsWith("==")) return { take: 1, put: "⇒" };
  }
  if (typed === ")") {
    const sign = /\((c|r|tm)$/i.exec(before);
    if (sign) return { take: sign[0].length, put: { c: "©", r: "®", tm: "™" }[sign[1]?.toLowerCase() ?? "c"] ?? ")" };
  }
  if (typed === ":") {
    const named = /(?:^|[\s(])(:([a-z0-9_+-]{1,24}))$/.exec(before);
    const emoji = named?.[2] === undefined ? undefined : EMOJI[named[2]];
    if (named?.[1] && emoji) return { take: named[1].length, put: emoji };
  }
  return null;
}

/** Whether the caret is in inline code, which is left as typed. */
function inCode(state: EditorState): boolean {
  const code = state.schema.marks.code;
  const marks: readonly Mark[] = caretMarks(state);
  return code !== undefined && code.isInSet(marks) !== undefined;
}

/** The transaction that types `text` as its substitution; null when there is none. */
export function typographyRule(state: EditorState, from: number, to: number, text: string, prefs: Pick<TextPrefs, "autocorrect" | "smartQuotes">): Transaction | null {
  if (text.length !== 1 || from !== to || inCode(state)) return null;
  const $from = state.doc.resolve(from);
  if ($from.parent.type.name !== "paragraph") return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\u0000");
  const found = substitution(before, text, prefs);
  if (!found) return null;
  const tr = closeHistory(state.tr);
  tr.replaceWith(from - found.take, to, state.schema.text(found.put, caretMarks(state)));
  return tr;
}

/**
 * The link an address before the caret becomes when a space is typed after it: a
 * transaction that marks the address, as its own step of undo; the space itself
 * is typed as usual afterwards.
 */
export function autolinkRule(state: EditorState, text: string): Transaction | null {
  if (text !== " ") return null;
  const found = addressBeforeCaret(state);
  const type = state.schema.marks.link;
  if (!found || !type) return null;
  return closeHistory(state.tr).addMark(found.from, found.to, type.create({ href: found.href }));
}

/** What the editor does with a character typed at `from`..`to`. `view` gets the transactions; true says the character is dealt with. */
export function typed(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  prefs: TextPrefs,
  dispatch: (tr: Transaction) => void,
): boolean {
  if (prefs.autoLists) {
    const tr = listRule(state, from, to, text);
    if (tr) {
      dispatch(tr);
      return true;
    }
  }
  if (prefs.autoLinks) {
    const tr = autolinkRule(state, text);
    if (tr) {
      // The address is marked, and the space after it is typed as usual by the caller.
      dispatch(tr);
      return false;
    }
  }
  if (!prefs.autocorrect && !prefs.smartQuotes) return false;
  const tr = typographyRule(state, from, to, text, prefs);
  if (!tr) return false;
  dispatch(tr);
  return true;
}
