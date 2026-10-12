// @vitest-environment node

import type { Paragraph, Text, Theme } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { applyListStyle, canRestart, continuePreviousList, continuedNumber, restartNumbering, setList, setStartNumber, toggleList } from "./list-commands.ts";
import { listNumbers } from "./lists.ts";
import { type Rig, rig, run, textOf } from "./test-state.ts";
import { themeNamed } from "./test-support.ts";

let light: Rig;

beforeAll(async () => {
  const theme: Theme = await themeNamed("Light");
  light = rig(theme, "body");
});

const text = (...paragraphs: Paragraph[]): Text => ({ paragraphs });
const num = (t: string, extra: Partial<Paragraph> = {}): Paragraph => ({ runs: [{ t }], list: "number", ...extra });
const plain = (t: string): Paragraph => ({ runs: [{ t }] });
const counts = (state: ReturnType<Rig["state"]>, base: Text) => listNumbers(textOf(state, base).paragraphs);

describe("styles of list", () => {
  it("puts one style on every selected paragraph, bullets or numbers as the style says", () => {
    const base = text(plain("a"), plain("b"));
    const arrow = run(light.state(base, [0, 0], [1, 1]), applyListStyle("arrow", light.ctx));
    expect(textOf(arrow, base).paragraphs.map((p) => [p.list, p.listStyle])).toEqual([["bullet", "arrow"], ["bullet", "arrow"]]);
    const roman = run(arrow, applyListStyle("upperRoman", light.ctx));
    expect(textOf(roman, base).paragraphs.map((p) => [p.list, p.listStyle])).toEqual([["number", "upperRoman"], ["number", "upperRoman"]]);
  });

  it("takes the style a list item has back to its level's own when the list changes kind", () => {
    const base = text({ runs: [{ t: "a" }], list: "bullet", listStyle: "check" });
    const numbered = run(light.state(base, [0, 0]), toggleList("number", light.ctx));
    expect(textOf(numbered, base).paragraphs[0]).toEqual({ runs: [{ t: "a" }], list: "number" });
    // A style of the same kind is kept when the list is made again.
    const kept = run(light.state(text({ runs: [{ t: "a" }], list: "number", listStyle: "lowerAlpha" }), [0, 0]), setList("number", light.ctx));
    expect(textOf(kept, base).paragraphs[0]?.listStyle).toBe("lowerAlpha");
  });

  it("puts the list's own room back when a list is put on words that were set where they stood", () => {
    const base = text({ runs: [{ t: "a" }], marginLeft: 40, indent: 5 });
    const listed = run(light.state(base, [0, 0]), toggleList("bullet", light.ctx));
    expect(textOf(listed, base).paragraphs[0]).toEqual({ runs: [{ t: "a" }], list: "bullet" });
  });
});

describe("restarting and continuing a numbered list", () => {
  const four = text(num("a"), num("b"), plain("break"), num("c"), num("d"));

  it("makes the item at the caret show 1 and the ones after it count on from there", () => {
    const base = text(num("a"), num("b"), num("c"), num("d"));
    expect(canRestart(light.state(base, [2, 0]))).toBe(true);
    const state = run(light.state(base, [2, 0]), restartNumbering);
    expect(counts(state, base)).toEqual([1, 2, 1, 2]);
    expect(textOf(state, base).paragraphs[2]?.start).toBe(1);
  });

  it("cannot restart what is not a numbered item", () => {
    expect(canRestart(light.state(four, [2, 0]))).toBe(false);
    expect(restartNumbering(light.state(four, [2, 0]))).toBe(false);
    expect(restartNumbering(light.state(four, [0, 0]), undefined)).toBe(true);
  });

  it("continues the list above across what interrupted it", () => {
    expect(counts(light.state(four, [0, 0]), four)).toEqual([1, 2, null, 1, 2]);
    expect(continuedNumber(light.state(four, [3, 0]))).toBe(3);
    const state = run(light.state(four, [3, 0]), continuePreviousList);
    expect(counts(state, four)).toEqual([1, 2, null, 3, 4]);
  });

  it("writes no number down where counting on would give it", () => {
    const base = text(num("a"), num("b"), num("c", { start: 3 }));
    const state = run(light.state(base, [2, 0]), continuePreviousList);
    expect(textOf(state, base).paragraphs[2]?.start).toBeUndefined();
    expect(counts(state, base)).toEqual([1, 2, 3]);
  });

  it("has nothing to continue at the first item, or under another level", () => {
    expect(continuedNumber(light.state(four, [0, 0]))).toBeNull();
    const base = text(num("a"), num("b", { level: 1 }), num("c", { level: 1 }));
    expect(continuedNumber(light.state(base, [1, 0]))).toBeNull();
    expect(continuePreviousList(light.state(base, [1, 0]))).toBe(false);
    // A shallower item between ends what could be continued.
    const between = text(num("a", { level: 1 }), num("b"), num("c", { level: 1 }));
    expect(continuedNumber(light.state(between, [2, 0]))).toBeNull();
  });

  it("begins at a number it is given, and goes back to counting on with null", () => {
    const base = text(num("a"), num("b"));
    const state = run(light.state(base, [1, 0]), setStartNumber(7));
    expect(counts(state, base)).toEqual([1, 7]);
    expect(counts(run(state, setStartNumber(null)), base)).toEqual([1, 2]);
    expect(counts(run(state, setStartNumber(0)), base)).toEqual([1, 1]);
  });
});
