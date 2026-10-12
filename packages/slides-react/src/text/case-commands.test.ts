// @vitest-environment node

import type { Text, Theme } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { changeCase, convertCase } from "./case-commands.ts";
import { type Rig, rig, run, textOf } from "./test-state.ts";
import { themeNamed } from "./test-support.ts";

let light: Rig;

beforeAll(async () => {
  const theme: Theme = await themeNamed("Light");
  light = rig(theme, "body");
});

describe("convertCase", () => {
  it("makes capitals and lower case, a letter at a time, so the text keeps its length", () => {
    expect(convertCase("Hello World", "upper")).toBe("HELLO WORLD");
    expect(convertCase("Hello World", "lower")).toBe("hello world");
    // A letter that would become two stays as it is.
    expect(convertCase("straße", "upper")).toBe("STRAßE");
  });

  it("capitalises each word in title case and lower-cases the rest", () => {
    expect(convertCase("the QUICK brown-fox (jumps)", "title")).toBe("The Quick Brown-Fox (Jumps)");
    expect(convertCase("ab", "title", "x")).toBe("ab");
    expect(convertCase("ab", "title", "x ")).toBe("Ab");
  });

  it("capitalises the start of each sentence in sentence case", () => {
    expect(convertCase("HELLO there. HOW are you? fine!  ok", "sentence")).toBe("Hello there. How are you? Fine!  Ok");
    expect(convertCase("hello", "sentence", "Hi. ")).toBe("Hello");
    expect(convertCase("hello", "sentence", "Hi, ")).toBe("hello");
    expect(convertCase("  hello", "sentence")).toBe("  Hello");
  });
});

describe("changeCase", () => {
  const base: Text = { paragraphs: [{ runs: [{ t: "hello " }, { t: "big", b: true }, { t: " world" }] }] };

  it("changes the selected words and keeps their looks", () => {
    const state = run(light.state(base, [0, 3], [0, 10]), changeCase("upper"));
    expect(textOf(state, base).paragraphs[0]?.runs).toEqual([{ t: "helLO " }, { t: "BIG", b: true }, { t: " world" }]);
  });

  it("changes the word at the caret when nothing is selected", () => {
    const state = run(light.state(base, [0, 2]), changeCase("upper"));
    expect(textOf(state, base).paragraphs[0]?.runs).toEqual([{ t: "HELLO " }, { t: "big", b: true }, { t: " world" }]);
  });

  it("does nothing, and says so, where there is no word", () => {
    const blank: Text = { paragraphs: [{ runs: [{ t: "" }] }] };
    expect(changeCase("upper")(light.state(blank, [0, 0]))).toBe(false);
    // A caret between two spaces has no word to take.
    const spaced: Text = { paragraphs: [{ runs: [{ t: "a  b" }] }] };
    expect(changeCase("upper")(light.state(spaced, [0, 2]))).toBe(false);
  });

  it("starts a sentence with a capital where the selection starts in the middle of one", () => {
    const text: Text = { paragraphs: [{ runs: [{ t: "one. two three" }] }] };
    const state = run(light.state(text, [0, 5], [0, 13]), changeCase("sentence"));
    expect(textOf(state, text).paragraphs[0]?.runs[0]?.t).toBe("one. Two three");
  });
});
