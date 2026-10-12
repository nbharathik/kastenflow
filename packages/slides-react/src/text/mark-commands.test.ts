// @vitest-environment node

import type { Paragraph, Text, Theme } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { formatStateOf, linkAtSelection } from "./format-state.ts";
import { clearFormatting, setFlag, setLink, setValueMark, sizeAtStart, stepFontSize, toggleFlag } from "./mark-commands.ts";
import { nextSize } from "./sizes.ts";
import { type Rig, rig, run, textOf, type as typeIn } from "./test-state.ts";
import { themeNamed } from "./test-support.ts";

let light: Rig;
let title: Rig;

beforeAll(async () => {
  const theme: Theme = await themeNamed("Light");
  light = rig(theme, "body");
  title = rig(theme, "title");
});

const text = (...paragraphs: Paragraph[]): Text => ({ paragraphs });
const p = (...runs: Paragraph["runs"]): Paragraph => ({ runs });
const runsOf = (state: Parameters<typeof textOf>[0], base: Text, index = 0) => textOf(state, base).paragraphs[index]?.runs;

describe("switches: bold, italic, underline, strike, code", () => {
  const hello = text(p({ t: "Hello world" }));

  it("turns a switch on for the selected words, and off again", () => {
    const on = run(light.state(hello, [0, 0], [0, 5]), toggleFlag("bold", light.ctx));
    expect(runsOf(on, hello)).toEqual([{ t: "Hello", b: true }, { t: " world" }]);
    const off = run(on, toggleFlag("bold", light.ctx));
    expect(runsOf(off, hello)).toEqual([{ t: "Hello world" }]);
  });

  it("does the same for each of the switches", () => {
    const names = { bold: "b", italic: "i", underline: "u", strike: "s", code: "code" } as const;
    for (const [flag, key] of Object.entries(names) as [keyof typeof names, string][]) {
      const on = run(light.state(hello, [0, 6], [0, 11]), toggleFlag(flag, light.ctx));
      expect(runsOf(on, hello), flag).toEqual([{ t: "Hello " }, { t: "world", [key]: true }]);
    }
  });

  it("turns a selection that is only partly on fully on", () => {
    const partly = text(p({ t: "ab", b: true }, { t: "cd" }));
    const on = run(light.state(partly, [0, 0], [0, 4]), toggleFlag("bold", light.ctx));
    expect(runsOf(on, partly)).toEqual([{ t: "abcd", b: true }]);
  });

  it("is set on or off for all of a selection whatever is on in it, which is how several boxes are toggled as one", () => {
    const partly = text(p({ t: "ab", b: true }, { t: "cd" }));
    const wanted = (on: boolean) => runsOf(run(light.state(partly, [0, 0], [0, 4]), setFlag("bold", on)), partly);
    expect(wanted(true)).toEqual([{ t: "abcd", b: true }]);
    expect(wanted(false)).toEqual([{ t: "abcd" }]);
  });

  it("reaches over paragraphs", () => {
    const two = text(p({ t: "one" }), p({ t: "two" }));
    const on = run(light.state(two, [0, 1], [1, 2]), toggleFlag("italic", light.ctx));
    expect(textOf(on, two).paragraphs).toEqual([p({ t: "o" }, { t: "ne", i: true }).runs, p({ t: "tw", i: true }, { t: "o" }).runs].map((runs) => ({ runs })));
  });

  it("sets a switch aside for the next words when there is only a caret", () => {
    const start = light.state(hello, [0, 5]);
    const on = run(start, toggleFlag("bold", light.ctx));
    expect(on.storedMarks?.map((mark) => mark.type.name)).toEqual(["bold"]);
    expect(runsOf(typeIn(on, "!"), hello)).toEqual([{ t: "Hello" }, { t: "!", b: true }, { t: " world" }]);
    const off = run(on, toggleFlag("bold", light.ctx));
    expect(runsOf(typeIn(off, "!"), hello)).toEqual([{ t: "Hello! world" }]);
  });

  it("carries on a run's formatting for words typed at its end", () => {
    const bold = text(p({ t: "Hi " }, { t: "bold", b: true }, { t: "big", size: 40, color: "accent2" }));
    const end = light.state(bold, [0, 10]);
    expect(runsOf(typeIn(end, "x"), bold)).toEqual([{ t: "Hi " }, { t: "bold", b: true }, { t: "bigx", size: 40, color: "accent2" }]);
  });

  it("does not carry a link on to words typed after it", () => {
    const linked = text(p({ t: "see " }, { t: "this", link: "https://example.com" }));
    expect(runsOf(typeIn(light.state(linked, [0, 8]), "!"), linked)).toEqual([{ t: "see " }, { t: "this", link: "https://example.com" }, { t: "!" }]);
    // Inside the link it does.
    expect(runsOf(typeIn(light.state(linked, [0, 6]), "!"), linked)).toEqual([{ t: "see " }, { t: "th!is", link: "https://example.com" }]);
  });

  it("cannot take away what a text style gives: the state shows it and toggling adds nothing", () => {
    const heading = text(p({ t: "Title" }));
    const state = title.state(heading, [0, 0], [0, 5]);
    expect(formatStateOf(state, title.ctx).bold).toBe(true);
    const toggled = run(state, toggleFlag("bold", title.ctx));
    expect(textOf(toggled, heading)).toBe(heading);
  });
});

describe("colour, size, font", () => {
  const hello = text(p({ t: "Hello world" }));

  it("sets a value on the selected words and takes it away with null", () => {
    let state = run(light.state(hello, [0, 0], [0, 5]), setValueMark("color", "accent2"));
    state = run(state, setValueMark("size", 32));
    state = run(state, setValueMark("font", "Georgia"));
    expect(runsOf(state, hello)).toEqual([{ t: "Hello", color: "accent2", size: 32, font: "Georgia" }, { t: " world" }]);
    state = run(state, setValueMark("color", null));
    state = run(state, setValueMark("size", null));
    state = run(state, setValueMark("font", null));
    expect(runsOf(state, hello)).toEqual([{ t: "Hello world" }]);
  });

  it("replaces a value rather than adding another", () => {
    let state = run(light.state(hello, [0, 0], [0, 11]), setValueMark("size", 12));
    state = run(state, setValueMark("size", 20));
    expect(runsOf(state, hello)).toEqual([{ t: "Hello world", size: 20 }]);
  });

  it("sets the value aside for the next words at a caret", () => {
    const state = run(light.state(hello, [0, 11]), setValueMark("color", "#ff0000"));
    expect(runsOf(typeIn(state, "!"), hello)).toEqual([{ t: "Hello world" }, { t: "!", color: "#ff0000" }]);
  });

  it("clears colour, size, font, switches and paragraph formatting, and keeps links and lists", () => {
    const styled = text({ runs: [{ t: "a", b: true, i: true, u: true, s: true, color: "accent1", size: 30, font: "Georgia", code: true }, { t: "b", link: "https://x.y" }], align: "center", lineSpacing: 2, spaceBefore: 3, spaceAfter: 4, style: "caption", list: "bullet", level: 1 });
    const cleared = run(light.state(styled, [0, 0], [0, 2]), clearFormatting);
    expect(textOf(cleared, styled).paragraphs).toEqual([{ runs: [{ t: "a" }, { t: "b", link: "https://x.y" }], list: "bullet", level: 1 }]);
  });

  it("clears the paragraph when there is only a caret in it", () => {
    const styled = text(p({ t: "abc", b: true }), p({ t: "def", b: true }));
    const cleared = run(light.state(styled, [1, 1]), clearFormatting);
    expect(textOf(cleared, styled).paragraphs).toEqual([{ runs: [{ t: "abc", b: true }] }, { runs: [{ t: "def" }] }]);
  });
});

describe("links", () => {
  const sentence = text(p({ t: "read " }, { t: "this", link: "https://old.example" }, { t: " now" }));

  it("links the selected words, or takes the link off", () => {
    const base = text(p({ t: "read this" }));
    const linked = run(light.state(base, [0, 5], [0, 9]), setLink("https://new.example"));
    expect(runsOf(linked, base)).toEqual([{ t: "read " }, { t: "this", link: "https://new.example" }]);
    const off = run(linked, setLink(null));
    expect(runsOf(off, base)).toEqual([{ t: "read this" }]);
  });

  it("changes the whole link when the caret is in it", () => {
    const changed = run(light.state(sentence, [0, 7]), setLink("https://new.example"));
    expect(runsOf(changed, sentence)).toEqual([{ t: "read " }, { t: "this", link: "https://new.example" }, { t: " now" }]);
    const off = run(light.state(sentence, [0, 9]), setLink(null));
    expect(runsOf(off, sentence)).toEqual([{ t: "read this now" }]);
  });

  it("puts the address in as text, linked, when the caret is not in a link", () => {
    const base = text(p({ t: "go: " }));
    const state = run(light.state(base, [0, 4]), setLink("https://x.example"));
    expect(runsOf(state, base)).toEqual([{ t: "go: " }, { t: "https://x.example", link: "https://x.example" }]);
    expect(run(light.state(base, [0, 4]), setLink(null)).doc.eq(light.state(base).doc)).toBe(true);
  });

  it("says which link the selection is in", () => {
    expect(linkAtSelection(light.state(sentence, [0, 7]))).toBe("https://old.example");
    expect(linkAtSelection(light.state(sentence, [0, 5]))).toBe("https://old.example");
    expect(linkAtSelection(light.state(sentence, [0, 2]))).toBeNull();
    expect(linkAtSelection(light.state(sentence, [0, 5], [0, 9]))).toBe("https://old.example");
    expect(linkAtSelection(light.state(sentence, [0, 0], [0, 9]))).toBeNull();
  });
});

describe("sizes", () => {
  it("steps along the list from any size", () => {
    expect([8, 10, 11, 12, 13, 22, 96, 100].map((n) => nextSize(n, 1))).toEqual([9, 11, 12, 14, 14, 24, 96, 100]);
    expect([8, 9, 12, 13, 22, 24, 96, 100, 5].map((n) => nextSize(n, -1))).toEqual([8, 8, 11, 12, 20, 20, 72, 96, 5]);
    expect(nextSize(22, 3)).toBe(32);
    expect(nextSize(22, -2)).toBe(18);
    expect(nextSize(22, 0)).toBe(22);
  });

  it("starts from the size of the text style when the text sets none", () => {
    const base = text(p({ t: "Hello" }));
    expect(sizeAtStart(light.state(base, [0, 2]), light.ctx)).toBe(22);
    expect(sizeAtStart(title.state(base, [0, 2]), title.ctx)).toBe(36);
    const up = run(light.state(base, [0, 0], [0, 5]), stepFontSize(1, light.ctx));
    expect(runsOf(up, base)).toEqual([{ t: "Hello", size: 24 }]);
    const down = run(light.state(base, [0, 0], [0, 5]), stepFontSize(-1, light.ctx));
    expect(runsOf(down, base)).toEqual([{ t: "Hello", size: 20 }]);
  });

  it("steps from the size the selection starts with, and gives all of it the same", () => {
    const base = text(p({ t: "ab", size: 12 }, { t: "cd", size: 40 }));
    const up = run(light.state(base, [0, 0], [0, 4]), stepFontSize(1, light.ctx));
    expect(runsOf(up, base)).toEqual([{ t: "abcd", size: 14 }]);
  });

  it("sets aside the stepped size for the next words at a caret", () => {
    const base = text(p({ t: "Hi", size: 16 }));
    const state = run(light.state(base, [0, 2]), stepFontSize(1, light.ctx));
    expect(runsOf(typeIn(state, "!"), base)).toEqual([{ t: "Hi", size: 16 }, { t: "!", size: 18 }]);
  });

  it("stays put at the end of the list", () => {
    const base = text(p({ t: "Hi", size: 96 }));
    const state = light.state(base, [0, 0], [0, 2]);
    expect(run(state, stepFontSize(1, light.ctx)).doc.eq(state.doc)).toBe(true);
  });
});
