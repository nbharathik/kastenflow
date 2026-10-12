// @vitest-environment node

import type { Paragraph, Text, Theme } from "@kasten-slides/wasm";
import { Fragment, Slice } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { beforeAll, describe, expect, it } from "vitest";

import { textToDoc } from "./convert.ts";
import { defaultListPlugin } from "./default-list.ts";
import { createTextSchema } from "./schema.ts";
import { type Rig, rig, select, textOf } from "./test-state.ts";
import { themeNamed } from "./test-support.ts";

let light: Rig;
let theme: Theme;

beforeAll(async () => {
  theme = await themeNamed("Light");
  light = rig(theme, "body");
});

const text = (...paragraphs: Paragraph[]): Text => ({ paragraphs });

function stateWith(base: Text, at: [number, number]): EditorState {
  const schema = createTextSchema(theme, "body");
  const state = EditorState.create({ schema, doc: textToDoc(base, schema), plugins: [defaultListPlugin("bullet")] });
  return select(state, at);
}

describe("a slot that makes lists of what is typed into it", () => {
  const empty = text({ runs: [{ t: "" }] });

  it("shows no bullet while it is empty and makes the first words an item", () => {
    const state = stateWith(empty, [0, 0]);
    expect(textOf(state, empty).paragraphs[0]?.list).toBeUndefined();
    const typed = state.apply(state.tr.insertText("Hello"));
    expect(textOf(typed, empty).paragraphs).toEqual([{ runs: [{ t: "Hello" }], list: "bullet" }]);
  });

  it("makes items of every paragraph pasted into it", () => {
    const state = stateWith(empty, [0, 0]);
    const schema = state.schema;
    const lines = Fragment.from([schema.nodes.paragraph!.create(null, schema.text("a")), schema.nodes.paragraph!.create(null, schema.text("b"))]);
    const next = state.apply(state.tr.replaceSelection(new Slice(lines, 0, 0)));
    expect(textOf(next, empty).paragraphs.map((p) => p.list)).toEqual(["bullet", "bullet"]);
  });

  it("leaves a paragraph whose list was taken off alone, and does nothing once there are words", () => {
    const plainWords = text({ runs: [{ t: "" }], marginLeft: 30 });
    const state = stateWith(plainWords, [0, 0]);
    const typed = state.apply(state.tr.insertText("x"));
    expect(textOf(typed, plainWords).paragraphs[0]?.list).toBeUndefined();

    const words = text({ runs: [{ t: "one" }] });
    const second = stateWith(words, [0, 3]);
    const more = second.apply(second.tr.insertText("!"));
    expect(textOf(more, words).paragraphs[0]?.list).toBeUndefined();
  });

  it("does not make a list of a box that is made without the plugin", () => {
    const state = light.state(empty, [0, 0]);
    const typed = state.apply(state.tr.insertText("Hello"));
    expect(textOf(typed, empty).paragraphs[0]?.list).toBeUndefined();
  });
});
