// @vitest-environment node

import type { Paragraph, Run, Text, Theme } from "@kasten-slides/wasm";
import { undo } from "prosemirror-history";
import type { EditorState } from "prosemirror-state";
import { beforeAll, describe, expect, it } from "vitest";

import { BULLET_SIZES, enter, setBulletColor, setBulletSize } from "./block-commands.ts";
import { nodeToParagraph } from "./convert.ts";
import { formatStateOf } from "./format-state.ts";
import { listRule } from "./input-rules.ts";
import { clearFormatting, setValueMark, toggleFlag } from "./mark-commands.ts";
import { lookOfMark } from "./paragraph-attrs.ts";
import { attrsOf } from "./schema.ts";
import { type Rig, rig, run, select, textOf, type as typeIn } from "./test-state.ts";
import { themeNamed } from "./test-support.ts";
import { markerPoints, paragraphCss, strutSize } from "./text-style.ts";

let light: Rig;
let theme: Theme;

beforeAll(async () => {
  theme = await themeNamed("Light");
  light = rig(theme, "body");
});

const text = (...paragraphs: Paragraph[]): Text => ({ paragraphs });
const item = (t: string, extra: Partial<Run> = {}, more: Partial<Paragraph> = {}): Paragraph => ({ list: "bullet", runs: [{ t, ...extra }], ...more });
const paragraphsOf = (state: EditorState, base: Text): Paragraph[] => textOf(state, base).paragraphs;
const markOf = (state: EditorState, index: number): Record<string, unknown> => lookOfMark(attrsOf(state.doc.child(index)).mark);
const names = (state: EditorState): string[] => (state.storedMarks ?? []).map((mark) => mark.type.name);

describe("the mark of an empty paragraph", () => {
  const base = text(item("How are you", { size: 12 }), item("", { size: 12, color: "accent2" }));

  it("is the look of the one empty run it holds, and comes back as it went", () => {
    const state = light.state(base);
    expect(markOf(state, 1)).toEqual({ size: 12, color: "accent2" });
    expect(markOf(state, 0)).toEqual({});
    expect(nodeToParagraph(state.doc.child(1)).runs).toEqual([{ t: "", size: 12, color: "accent2" }]);
    expect(textOf(state, base)).toBe(base);
  });

  it("is nothing for an empty paragraph with no look, and for one with words", () => {
    const plain = text({ runs: [{ t: "" }] }, item("words", { size: 12 }));
    const state = light.state(plain);
    expect(attrsOf(state.doc.child(0)).mark).toBeNull();
    expect(attrsOf(state.doc.child(1)).mark).toBeNull();
    expect(textOf(state, plain)).toBe(plain);
  });

  it("measures the line and the marker of the empty paragraph as the words are measured", () => {
    const [words, empty] = base.paragraphs as [Paragraph, Paragraph];
    expect(strutSize(theme, "body", empty)).toBe(12);
    expect(markerPoints(theme, "body", empty)).toBe(12);
    expect(paragraphCss(theme, "body", empty).fontSize).toBe(paragraphCss(theme, "body", words).fontSize);
    expect(paragraphCss(theme, "body", empty)["--ks-marker-size"]).toBe(paragraphCss(theme, "body", words)["--ks-marker-size"]);
    // A marker's own scale is of the paragraph's own size, with or without words.
    expect(markerPoints(theme, "body", { ...empty, bulletSize: 2 })).toBe(24);
  });

  it("is measured by the text style when it has no look", () => {
    const plain: Paragraph = { list: "bullet", runs: [{ t: "" }] };
    expect(strutSize(theme, "body", plain)).toBe(theme.textStyles.body?.size);
  });
});

describe("a size, colour or font set on a selection", () => {
  const base = text(item("How are you"), item(""), item("fine"));

  it("reaches the empty paragraphs in it as well as the words", () => {
    const state = run(light.state(base, [0, 0], [2, 4]), setValueMark("size", 12));
    expect(paragraphsOf(state, base)).toEqual([item("How are you", { size: 12 }), item("", { size: 12 }), item("fine", { size: 12 })]);
  });

  it("does the same for colour and font, and takes them away with null", () => {
    let state = run(light.state(base, [0, 0], [2, 4]), setValueMark("color", "accent2"));
    state = run(state, setValueMark("font", "Georgia"));
    expect(markOf(state, 1)).toEqual({ color: "accent2", font: "Georgia" });
    state = run(state, setValueMark("color", null));
    expect(markOf(state, 1)).toEqual({ font: "Georgia" });
    expect(paragraphsOf(state, base)[1]?.runs).toEqual([{ t: "", font: "Georgia" }]);
  });

  it("reaches an empty paragraph that is all that is selected", () => {
    const state = run(light.state(base, [1, 0], [1, 0]), setValueMark("size", 30));
    expect(paragraphsOf(state, base)[1]?.runs).toEqual([{ t: "", size: 30 }]);
    expect(paragraphsOf(state, base)[0]).toBe(base.paragraphs[0]);
  });

  it("reaches the empty paragraphs of a whole box that is formatted without being opened", () => {
    const all = text(item("one"), item(""));
    const state = run(light.state(all, [0, 0], [1, 0]), toggleFlag("bold", light.ctx));
    expect(paragraphsOf(state, all)).toEqual([item("one", { b: true }), item("", { b: true })]);
    const off = run(state, toggleFlag("bold", light.ctx));
    expect(paragraphsOf(off, all)).toEqual([item("one"), item("")]);
  });

  it("is what the toolbar shows for a selection of empty paragraphs", () => {
    const empties = text(item("", { size: 20 }), item("", { size: 20 }));
    expect(formatStateOf(light.state(empties, [0, 0], [1, 0]), light.ctx).size).toBe(20);
    const mixed = text(item("", { size: 20 }), item("", { size: 10 }));
    expect(formatStateOf(light.state(mixed, [0, 0], [1, 0]), light.ctx).size).toBe("mixed");
  });

  it("is not counted against the words when the toolbar says what they are", () => {
    const some = text(item("bold", { b: true }), item(""));
    expect(formatStateOf(light.state(some, [0, 0], [1, 0]), light.ctx).bold).toBe(true);
  });
});

describe("a caret in an empty paragraph", () => {
  const base = text(item("How are you", { size: 12 }), item(""));

  it("sets the look of the paragraph and of the words typed there", () => {
    const set = run(light.state(base, [1, 0]), setValueMark("size", 14));
    expect(markOf(set, 1)).toEqual({ size: 14 });
    expect(names(set)).toEqual(["size"]);
    const typed = typeIn(set, "x");
    expect(paragraphsOf(typed, base)[1]).toEqual(item("x", { size: 14 }));
  });

  it("is left alone while words are typed, since a paragraph that changes is drawn again, and is ignored once it has words", () => {
    const typed = typeIn(run(light.state(base, [1, 0]), setValueMark("size", 14)), "x");
    expect(markOf(typed, 1)).toEqual({ size: 14 });
    const written = textOf(typed, base);
    expect(written.paragraphs[1]).toEqual(item("x", { size: 14 }));
    // What is written holds the words only, and the same words with the old mark are the same paragraph.
    expect(textOf(typed, written)).toBe(written);
    const copy = (typed.doc.child(1).type.spec.toDOM?.(typed.doc.child(1)) ?? []) as unknown[];
    expect(JSON.stringify(copy)).not.toContain("mark");
  });

  it("is replaced by the look of the words it is emptied of, and not left as it was", () => {
    let state = typeIn(run(light.state(base, [1, 0]), setValueMark("size", 14)), "x");
    state = select(state, [1, 0], [1, 1]);
    state = run(state, setValueMark("size", 30));
    const emptied = state.apply(state.tr.deleteSelection());
    expect(paragraphsOf(emptied, base)[1]).toEqual(item("", { size: 30 }));
    // Words with no look at all leave an empty paragraph with none, though it was marked before.
    const plain = typeIn(select(emptied, [1, 0]), "y");
    const cleared = select(run(select(plain, [1, 0], [1, 1]), setValueMark("size", null)), [1, 0], [1, 1]);
    expect(paragraphsOf(cleared.apply(cleared.tr.deleteSelection()), base)[1]).toEqual(item(""));
  });

  it("keeps it when the caret goes away and comes back", () => {
    let state = run(light.state(base, [1, 0]), setValueMark("size", 14));
    state = select(state, [0, 3]);
    expect(names(state)).toEqual([]);
    state = select(state, [1, 0]);
    expect(names(state)).toEqual(["size"]);
    expect(paragraphsOf(typeIn(state, "x"), base)[1]).toEqual(item("x", { size: 14 }));
  });

  it("adds to the look it has, so a second setting does not undo the first", () => {
    let state = run(light.state(base, [1, 0]), setValueMark("size", 14));
    state = run(state, toggleFlag("bold", light.ctx));
    state = run(state, setValueMark("color", "accent1"));
    expect(markOf(state, 1)).toEqual({ b: true, color: "accent1", size: 14 });
    expect(paragraphsOf(typeIn(state, "x"), base)[1]).toEqual(item("x", { size: 14, b: true, color: "accent1" }));
  });

  it("takes a switch off again", () => {
    let state = run(light.state(base, [1, 0]), toggleFlag("italic", light.ctx));
    expect(markOf(state, 1)).toEqual({ i: true });
    state = run(state, toggleFlag("italic", light.ctx));
    expect(markOf(state, 1)).toEqual({});
    expect(paragraphsOf(state, base)[1]).toEqual(item(""));
  });

  it("is what the toolbar shows, and what a size step steps from", () => {
    const state = run(light.state(base, [1, 0]), setValueMark("size", 14));
    expect(formatStateOf(state, light.ctx).size).toBe(14);
    expect(formatStateOf(select(select(state, [0, 0]), [1, 0]), light.ctx).size).toBe(14);
  });

  it("changes only what the caret is aimed at when it is in words", () => {
    const words = text(item("How are you", { size: 12 }), item("fine"));
    const state = run(light.state(words, [1, 2]), setValueMark("size", 30));
    expect(paragraphsOf(state, words)).toEqual(words.paragraphs);
    expect(names(state)).toEqual(["size"]);
  });
});

describe("Enter", () => {
  it("goes on in the look of the words before the caret, bullet and all", () => {
    const base = text(item("How are you", { size: 12, b: true }));
    const state = run(light.state(base, [0, 11]), enter(light.ctx));
    expect(paragraphsOf(state, base)).toEqual([item("How are you", { size: 12, b: true }), item("", { size: 12, b: true })]);
    expect(names(state).sort()).toEqual(["bold", "size"]);
    expect(paragraphsOf(typeIn(state, "fine"), base)[1]).toEqual(item("fine", { size: 12, b: true }));
  });

  it("makes the bullet of the new line as large as the one above it", () => {
    const base = text(item("How are you", { size: 12 }));
    const state = run(light.state(base, [0, 11]), enter(light.ctx));
    const [first, second] = paragraphsOf(state, base) as [Paragraph, Paragraph];
    expect(markerPoints(theme, "body", second)).toBe(markerPoints(theme, "body", first));
    expect(paragraphCss(theme, "body", second).fontSize).toBe(paragraphCss(theme, "body", first).fontSize);
  });

  it("leaves the marker's own size and colour on the new item too", () => {
    const base = text(item("one", { size: 20 }, { bulletSize: 1.5, bulletColor: "accent2" }));
    const state = run(light.state(base, [0, 3]), enter(light.ctx));
    expect(paragraphsOf(state, base)[1]).toEqual(item("", { size: 20 }, { bulletSize: 1.5, bulletColor: "accent2" }));
  });

  it("keeps the look of an empty paragraph when it is split", () => {
    const base = text({ runs: [{ t: "", size: 18 }] });
    const split = run(light.state(base, [0, 0]), enter(light.ctx));
    expect(paragraphsOf(split, base)).toEqual([{ runs: [{ t: "", size: 18 }] }, { runs: [{ t: "", size: 18 }] }]);
  });

  it("ends the list at an empty item without losing its look", () => {
    const base = text(item("", { size: 18 }));
    const state = run(light.state(base, [0, 0]), enter(light.ctx));
    expect(paragraphsOf(state, base)).toEqual([{ runs: [{ t: "", size: 18 }] }]);
  });

  it("at the start of a line leaves the empty line above in the look of the words", () => {
    const base = text({ runs: [{ t: "words", size: 40 }] });
    const state = run(light.state(base, [0, 0]), enter(light.ctx));
    expect(paragraphsOf(state, base)).toEqual([{ runs: [{ t: "", size: 40 }] }, { runs: [{ t: "words", size: 40 }] }]);
  });

  it("in the middle of words splits them and leaves no mark", () => {
    const base = text({ runs: [{ t: "ab", size: 40 }, { t: "cd" }] });
    const state = run(light.state(base, [0, 2]), enter(light.ctx));
    expect(paragraphsOf(state, base)).toEqual([{ runs: [{ t: "ab", size: 40 }] }, { runs: [{ t: "cd" }] }]);
  });
});

describe("emptying a paragraph", () => {
  it("leaves it in the look its words had", () => {
    const base = text(item("gone", { size: 12, b: true, color: "accent3" }));
    const state = light.state(base, [0, 0], [0, 4]);
    const emptied = state.apply(state.tr.deleteSelection());
    expect(paragraphsOf(emptied, base)).toEqual([item("", { size: 12, b: true, color: "accent3" })]);
    expect(paragraphsOf(typeIn(emptied, "new"), base)[0]).toEqual(item("new", { size: 12, b: true, color: "accent3" }));
  });

  it("takes the look of the first words when they differ", () => {
    const base = text({ runs: [{ t: "ab", size: 12 }, { t: "cd", size: 30 }] });
    const state = light.state(base, [0, 0], [0, 4]);
    expect(paragraphsOf(state.apply(state.tr.deleteSelection()), base)).toEqual([{ runs: [{ t: "", size: 12 }] }]);
  });

  it("does not take a link or a field with it", () => {
    const base = text({ runs: [{ t: "see", link: "https://example.com", size: 12 }] });
    const state = light.state(base, [0, 0], [0, 3]);
    expect(paragraphsOf(state.apply(state.tr.deleteSelection()), base)).toEqual([{ runs: [{ t: "", size: 12 }] }]);
  });

  it("is undone with the words", () => {
    const base = text(item("gone", { size: 12 }));
    const state = light.state(base, [0, 0], [0, 4]);
    const emptied = state.apply(state.tr.deleteSelection());
    const back = run(emptied, undo);
    expect(paragraphsOf(back, base)).toEqual(base.paragraphs);
  });

  it("is what a list marker typed over is made of: the new item has the size of the paragraph", () => {
    const base = text({ runs: [{ t: "-", size: 12 }] });
    const state = light.state(base, [0, 1]);
    const tr = listRule(state, state.selection.from, state.selection.from, " ");
    expect(tr).not.toBeNull();
    expect(paragraphsOf(state.apply(tr!), base)).toEqual([{ list: "bullet", runs: [{ t: "", size: 12 }] }]);
  });
});

describe("clearing formatting", () => {
  it("takes the look off an empty paragraph and its marker", () => {
    const base = text(item("", { size: 12, b: true }, { bulletSize: 1.5, bulletColor: "accent2" }));
    const state = run(light.state(base, [0, 0]), clearFormatting);
    expect(paragraphsOf(state, base)).toEqual([item("")]);
    expect(names(state)).toEqual([]);
  });

  it("does so for every paragraph of a selection", () => {
    const base = text(item("one", { size: 12 }), item("", { size: 12 }));
    const state = run(light.state(base, [0, 0], [1, 0]), clearFormatting);
    expect(paragraphsOf(state, base)).toEqual([item("one"), item("")]);
  });
});

describe("undoing a change of look", () => {
  it("puts the paragraph's mark back", () => {
    const base = text(item("one"), item(""));
    const set = run(light.state(base, [1, 0]), setValueMark("size", 30));
    expect(markOf(set, 1)).toEqual({ size: 30 });
    const back = run(set, undo);
    expect(paragraphsOf(back, base)).toEqual(base.paragraphs);
  });

  it("puts the paragraph's mark back after the words typed into it are undone", () => {
    const base = text(item("one"), item("", { size: 30 }));
    const typed = typeIn(light.state(base, [1, 0]), "x");
    expect(paragraphsOf(typed, base)[1]).toEqual(item("x", { size: 30 }));
    expect(paragraphsOf(run(typed, undo), base)).toEqual(base.paragraphs);
  });
});

describe("the size and colour of a marker", () => {
  const base = text(item("one"), item("two"), item("three"), { runs: [{ t: "plain" }] });

  it("is set for the whole paragraph a caret is in", () => {
    const state = run(light.state(base, [1, 1]), setBulletSize(1.5));
    expect(paragraphsOf(state, base).map((p) => p.bulletSize)).toEqual([undefined, 1.5, undefined, undefined]);
  });

  it("is set for every item a selection touches, and not for what is no item", () => {
    const state = run(light.state(base, [0, 1], [3, 2]), setBulletSize(2));
    expect(paragraphsOf(state, base).map((p) => p.bulletSize)).toEqual([2, 2, 2, undefined]);
    const coloured = run(state, setBulletColor("accent2"));
    expect(paragraphsOf(coloured, base).map((p) => p.bulletColor)).toEqual(["accent2", "accent2", "accent2", undefined]);
  });

  it("goes back to the size and colour of the words with null, and 100% is the same", () => {
    let state = run(light.state(base, [0, 0], [2, 0]), setBulletSize(2));
    state = run(state, setBulletColor("#c0392b"));
    const plain = run(run(state, setBulletSize(null)), setBulletColor(null));
    expect(paragraphsOf(plain, base)).toEqual(base.paragraphs);
    expect(paragraphsOf(run(state, setBulletSize(1)), base).map((p) => p.bulletSize)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("is kept between 25% and 400%, and is not set to what is not a number", () => {
    const at = (share: number) => paragraphsOf(run(light.state(base, [0, 0]), setBulletSize(share)), base)[0]?.bulletSize;
    expect(at(10)).toBe(BULLET_SIZES.max);
    expect(at(0.1)).toBe(BULLET_SIZES.min);
    expect(at(5)).toBe(4);
    expect(at(1.234)).toBe(1.23);
    const state = light.state(base, [0, 0]);
    expect(setBulletSize(Number.NaN)(state)).toBe(false);
  });

  it("changes nothing, and costs no step of undo, where it is already so", () => {
    const sized = text(item("one", {}, { bulletSize: 1.5 }));
    const state = light.state(sized, [0, 0]);
    let dispatched = 0;
    setBulletSize(1.5)(state, () => (dispatched += 1));
    expect(dispatched).toBe(0);
  });

  it("is reported for what is selected", () => {
    const mixed = text(item("a", {}, { bulletSize: 1.5, bulletColor: "accent2" }), item("b"));
    expect(formatStateOf(light.state(mixed, [0, 0]), light.ctx)).toMatchObject({ bulletSize: 1.5, bulletColor: "accent2" });
    expect(formatStateOf(light.state(mixed, [0, 0], [1, 1]), light.ctx)).toMatchObject({ bulletSize: "mixed", bulletColor: "mixed" });
    expect(formatStateOf(light.state(mixed, [1, 0]), light.ctx)).toMatchObject({ bulletSize: null, bulletColor: null });
  });

  it("follows the size of the words it is in front of", () => {
    const sized = text(item("a", { size: 20 }, { bulletSize: 1.5 }), item("", { size: 20 }, { bulletSize: 1.5 }));
    const [first, second] = sized.paragraphs as [Paragraph, Paragraph];
    expect(markerPoints(theme, "body", first)).toBe(30);
    expect(markerPoints(theme, "body", second)).toBe(30);
  });
});
