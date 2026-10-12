// Editor states for the tests of this folder, without a page: ProseMirror's
// state, model and transforms need none.

import type { Text, Theme } from "@kasten-slides/wasm";
import { history } from "prosemirror-history";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";

import { docToText, textToDoc } from "./convert.ts";
import { paragraphMarks } from "./paragraph-mark.ts";
import { type TextSchema, createTextSchema } from "./schema.ts";
import type { Command } from "./mark-commands.ts";
import type { EditorContext } from "./selection-info.ts";

export interface Rig {
  ctx: EditorContext;
  schema: TextSchema;
  /** A state holding `text`, with the caret or selection at `from`..`to` given as [paragraph, offset]. */
  state(text: Text, from?: [number, number], to?: [number, number]): EditorState;
}

export function rig(theme: Theme, baseStyle = "body"): Rig {
  const schema = createTextSchema(theme, baseStyle);
  return {
    ctx: { theme, baseStyle },
    schema,
    state(text, from, to) {
      const state = EditorState.create({ schema, doc: textToDoc(text, schema), plugins: [history(), paragraphMarks()] });
      return from ? select(state, from, to ?? from) : state;
    },
  };
}

/** The document position of an offset in a paragraph. */
export function position(state: EditorState, paragraph: number, offset: number): number {
  let pos = 0;
  for (let i = 0; i < paragraph; i++) pos += state.doc.child(i).nodeSize;
  return pos + 1 + offset;
}

export function select(state: EditorState, from: [number, number], to: [number, number] = from): EditorState {
  const selection = TextSelection.create(state.doc, position(state, ...from), position(state, ...to));
  return state.apply(state.tr.setSelection(selection));
}

/** What a command does to a state; the state itself when the command does not apply. */
export function run(state: EditorState, command: Command): EditorState {
  let next = state;
  const applied = command(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  if (!applied) return state;
  return next;
}

/** The text of a state, written against the text it was made from. */
export const textOf = (state: EditorState, base: Text): Text => docToText(state.doc, base);

/** Types text at the selection, as a keystroke would. */
export const type = (state: EditorState, text: string): EditorState => state.apply(state.tr.insertText(text));
