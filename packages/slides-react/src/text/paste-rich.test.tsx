import type { Paragraph, Text, Theme } from "@kasten-slides/wasm";
import { cleanup, fireEvent } from "@testing-library/react";
import type { EditorView } from "prosemirror-view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { hexOfCss, isDefaultInk, parseHtml, parseTextWithLists, pointsOfCss, sizesFor } from "./paste-html.ts";
import { type Mounted, mount, selectRange } from "./test-editor.tsx";
import { installDomShims, themeNamed } from "./test-support.ts";

let light: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  installDomShims();
});

afterEach(cleanup);

const p = (...runs: Paragraph["runs"]): Paragraph => ({ runs });
const text = (...paragraphs: Paragraph[]): Text => ({ paragraphs });

function paste(view: EditorView, data: { html?: string; text?: string }): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const contents: Record<string, string> = { "text/html": data.html ?? "", "text/plain": data.text ?? "" };
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => contents[type] ?? "", types: Object.keys(contents).filter((type) => contents[type]) } });
  view.dom.dispatchEvent(event);
}

const paragraphsOf = (editor: Mounted): Paragraph[] => editor.handle.getText().paragraphs;

describe("reading a page's looks", () => {
  it("reads colours from hex and rgb, and sizes from points and pixels", () => {
    expect(hexOfCss("#F00")).toBe("#ff0000");
    expect(hexOfCss("rgb(18, 171, 52)")).toBe("#12ab34");
    expect(hexOfCss("rgba(0, 0, 0, 0)")).toBeNull();
    expect(hexOfCss("red")).toBeNull();
    expect(pointsOfCss("12pt")).toBe(12);
    expect(pointsOfCss("16px")).toBe(12);
    expect(pointsOfCss("1.2em")).toBeNull();
  });

  it("takes near black and near white, with no tint, for the page's own ink and not a choice", () => {
    expect(isDefaultInk("#000000")).toBe(true);
    expect(isDefaultInk("#222222")).toBe(true);
    expect(isDefaultInk("#ffffff")).toBe(true);
    expect(isDefaultInk("#ea4335")).toBe(false);
    expect(isDefaultInk("#808080")).toBe(false);
    expect(isDefaultInk("#10204a")).toBe(false);
  });

  it("reads where a numbered list begins, its look, raised words and code", () => {
    const html = '<ol start="3" style="list-style-type:lower-alpha"><li>c</li><li>d</li></ol><p>x<sup>2</sup> H<sub>2</sub>O <code>f()</code></p><ul style="list-style-type: square"><li>s</li></ul>';
    const found = parseHtml(html);
    expect(found.map((q) => [q.list, q.listStyle, q.start])).toEqual([["number", "lowerAlpha", 3], ["number", "lowerAlpha", null], [null, null, null], ["bullet", "square", null]]);
    const runs = found[2]!.runs;
    expect(runs.map((r) => [r.text, r.script ?? null, r.code ?? false])).toEqual([["x", null, false], ["2", "super", false], [" H", null, false], ["2", "sub", false], ["O ", null, false], ["f()", null, true]]);
  });
});

describe("the size words land at", () => {
  it("is the size at the caret for the page's own body size, and in proportion for any other", () => {
    const runs = (...sizes: number[]) => [{ list: null, level: 0, runs: sizes.map((size) => ({ text: "abcdefghij", bold: false, italic: false, underline: false, strike: false, link: null, size })) }];
    const sized = sizesFor(runs(11, 11, 11, 22, 8), 22);
    expect(sized({ ...runs(11)[0]!.runs[0]! })).toBeNull();
    expect(sized({ ...runs(22)[0]!.runs[0]! })).toBe(44);
    // Never below half or above three times the size it lands at.
    expect(sized({ ...runs(8)[0]!.runs[0]! })).toBe(16);
    expect(sizesFor(runs(10, 10, 100), 20)({ ...runs(100)[0]!.runs[0]! })).toBe(60);
    expect(sized({ ...runs(11)[0]!.runs[0]!, size: null })).toBeNull();
  });
});

describe("pasting from a page", () => {
  it("keeps a colour that was chosen and leaves the page's black, and keeps raised words and code", () => {
    const editor = mount(light, text(p({ t: "" })), { autoFocus: "start" });
    paste(editor.view, { html: '<p><span style="color:#000000">black</span> <span style="color:#ea4335">red</span> x<sup>2</sup> <code>f()</code></p>', text: "black red x2 f()" });
    expect(paragraphsOf(editor)[0]?.runs).toEqual([{ t: "black " }, { t: "red", color: "#ea4335" }, { t: " x" }, { t: "2", script: "super" }, { t: " " }, { t: "f()", code: true }]);
  });

  it("sets sizes in proportion to the size at the caret", () => {
    const editor = mount(light, text(p({ t: "x" })), { autoFocus: "start" });
    selectRange(editor.view, 2);
    paste(editor.view, { html: '<p><span style="font-size:11pt">body </span><span style="font-size:22pt">big</span></p>', text: "body big" });
    // The caret is in a 22 pt body: the page's 11 pt is the same size, and its 22 pt is twice that.
    expect(paragraphsOf(editor)[0]?.runs).toEqual([{ t: "xbody " }, { t: "big", size: 44 }]);
  });

  it("makes a list of a numbered list that begins at a number, with its look", () => {
    const editor = mount(light, text(p({ t: "" })), { autoFocus: "start" });
    paste(editor.view, { html: '<ol start="4" type="a"><li>d</li><li>e</li></ol>', text: "d\ne" });
    expect(paragraphsOf(editor)).toEqual([
      { runs: [{ t: "d" }], list: "number", listStyle: "lowerAlpha", start: 4 },
      { runs: [{ t: "e" }], list: "number", listStyle: "lowerAlpha" },
    ]);
  });

  it("makes a list of plain text that is written as one, with its levels", () => {
    const editor = mount(light, text(p({ t: "" })), { autoFocus: "start" });
    paste(editor.view, { text: "- one\n  - nested\n- two\n1. first\n2. second" });
    expect(paragraphsOf(editor)).toEqual([
      { runs: [{ t: "one" }], list: "bullet" },
      { runs: [{ t: "nested" }], list: "bullet", level: 1 },
      { runs: [{ t: "two" }], list: "bullet" },
      { runs: [{ t: "first" }], list: "number" },
      { runs: [{ t: "second" }], list: "number" },
    ]);
  });

  it("pastes the same plain text as lines, not as a list, with Mod-Shift-v", () => {
    const editor = mount(light, text(p({ t: "" })), { autoFocus: "start" });
    fireEvent.keyDown(editor.view.dom, { key: "V", ctrlKey: true, shiftKey: true, keyCode: 86 });
    paste(editor.view, { text: "- one\n- two" });
    expect(paragraphsOf(editor)).toEqual([p({ t: "- one" }), p({ t: "- two" })]);
  });
});

describe("plain text that is written as a list", () => {
  const found = (words: string) => parseTextWithLists(words).map((q) => [q.list, q.level, q.start ?? null, q.runs.map((r) => r.text).join("")]);

  it("takes bullets, numbers and letters, a level for each two spaces", () => {
    expect(found("• a\n\t- b\n    * c")).toEqual([["bullet", 0, null, "a"], ["bullet", 1, null, "b"], ["bullet", 2, null, "c"]]);
    expect(found("3. c\n4) d\nb. e")).toEqual([["number", 0, 3, "c"], ["number", 0, 4, "d"], ["number", 0, 2, "e"]]);
  });

  it("leaves text with no marker alone, and an ordinary line in the middle of a list", () => {
    expect(found("just\nlines")).toEqual([[null, 0, null, "just"], [null, 0, null, "lines"]]);
    expect(found("- a\nplain\n- b")).toEqual([["bullet", 0, null, "a"], [null, 0, null, "plain"], ["bullet", 0, null, "b"]]);
    expect(found("-nospace")).toEqual([[null, 0, null, "-nospace"]]);
  });
});
