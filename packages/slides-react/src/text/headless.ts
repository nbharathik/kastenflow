// The editor's commands, run on a text that is not being edited: a box that is
// only selected is formatted by the very commands its words are formatted with
// when they are open, so a bullet, an indent or a change of case does the same
// whichever way it is asked for. The whole text is the selection.

import type { Text, Theme } from "@kasten-slides/wasm";
import { EditorState } from "prosemirror-state";

import { docToText, textToDoc } from "./convert.ts";
import { type FormatState, formatStateOf } from "./format-state.ts";
import type { Command } from "./mark-commands.ts";
import { createTextSchema } from "./schema.ts";
import { type EditorContext, wholeText } from "./selection-info.ts";

function whole(theme: Theme, baseStyle: string, text: Text): { state: EditorState; ctx: EditorContext } {
  const schema = createTextSchema(theme, baseStyle);
  const state = EditorState.create({ schema, doc: textToDoc(text, schema) });
  return { state: state.apply(state.tr.setSelection(wholeText(state))), ctx: { theme, baseStyle } };
}

/**
 * The text after `make`'s command has been run on all of it. The same text object comes back when the command changes
 * nothing, and a paragraph it does not touch comes back as the very object it was.
 */
export function runOnText(theme: Theme, baseStyle: string, text: Text, make: (ctx: EditorContext) => Command): Text {
  const { state, ctx } = whole(theme, baseStyle, text);
  let next = state;
  const done = make(ctx)(state, (tr) => {
    next = state.apply(tr);
  });
  return done && next !== state ? docToText(next.doc, text) : text;
}

/** How all of `text` is formatted, as the editor says it of a selection. */
export function formatOfText(theme: Theme, baseStyle: string, text: Text): FormatState {
  const { state, ctx } = whole(theme, baseStyle, text);
  return { ...formatStateOf(state, ctx), fit: text.fit ?? "none", wrap: text.wrap !== false };
}
