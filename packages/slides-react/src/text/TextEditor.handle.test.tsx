import type { Theme } from "@kasten-slides/wasm";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installDomShims, themeNamed } from "./test-support.ts";
import { hello, mount, p, selectRange, text, words } from "./test-editor.tsx";

let light: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  installDomShims();
});

afterEach(cleanup);

describe("the toolbar handle", () => {
  it("formats the selected words", () => {
    const editor = mount(light, hello, { autoFocus: "start" });
    selectRange(editor.view, 1, 6);
    editor.handle.toggleBold();
    editor.handle.toggleItalic();
    editor.handle.toggleUnderline();
    editor.handle.toggleStrike();
    editor.handle.toggleCode();
    editor.handle.setColor("accent2");
    editor.handle.setSize(30);
    editor.handle.setFont("Georgia");
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Hello", b: true, i: true, u: true, s: true, color: "accent2", size: 30, font: "Georgia", code: true }, { t: " world" }]);
    expect(editor.handle.formatState()).toMatchObject({ bold: true, italic: true, underline: true, strike: true, code: true, color: "accent2", size: 30, font: "Georgia" });
    editor.handle.clearFormatting();
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Hello world" }]);
  });

  it("takes colour, size and font off with null", () => {
    const editor = mount(light, text(p({ t: "Hello", color: "accent1", size: 12, font: "Georgia" })), { autoFocus: "all" });
    editor.handle.setColor(null);
    editor.handle.setSize(null);
    editor.handle.setFont(null);
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Hello" }]);
  });

  it("refuses a colour, size or spacing that makes no sense", () => {
    const editor = mount(light, hello, { autoFocus: "all" });
    editor.handle.setColor("red");
    editor.handle.setColor("");
    editor.handle.setSize(0);
    editor.handle.setSize(-4);
    editor.handle.setSize(Number.NaN);
    editor.handle.setLineSpacing(0);
    editor.handle.setLineSpacing(-1);
    editor.handle.setFont("  ");
    expect(editor.handle.getText()).toBe(hello);
    editor.handle.setColor("#12AB34");
    editor.handle.setSize(10.555);
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Hello world", color: "#12AB34", size: 10.56 }]);
  });

  it("steps the size along the list", () => {
    const editor = mount(light, hello, { autoFocus: "all" });
    editor.handle.stepSize(1);
    expect(editor.handle.formatState().size).toBe(24);
    editor.handle.stepSize(1);
    editor.handle.stepSize(1);
    expect(editor.handle.formatState().size).toBe(32);
    editor.handle.stepSize(-1);
    expect(editor.handle.formatState().size).toBe(28);
  });

  it("aligns, makes lists, indents and spaces paragraphs", () => {
    const editor = mount(light, text(p({ t: "one" }), p({ t: "two" })), { autoFocus: "all" });
    editor.handle.setAlign("right");
    editor.handle.toggleList("number");
    editor.handle.indent(1);
    editor.handle.indent(1);
    editor.handle.indent(-1);
    editor.handle.setLineSpacing(1.5);
    expect(editor.handle.getText().paragraphs).toEqual([
      { runs: [{ t: "one" }], align: "right", list: "number", level: 1, lineSpacing: 1.5 },
      { runs: [{ t: "two" }], align: "right", list: "number", level: 1, lineSpacing: 1.5 },
    ]);
    expect(editor.handle.formatState()).toMatchObject({ align: "right", list: "number", level: 1, lineSpacing: 1.5 });
    editor.handle.setLineSpacing(null);
    editor.handle.toggleList("number");
    // The list is off and the words stay where they were: 24 for the empty first level and 36 for the "a." of the second.
    expect(editor.handle.getText().paragraphs[0]).toEqual({ runs: [{ t: "one" }], align: "right", level: 1, marginLeft: 60 });
  });

  it("links text, or takes the link off, and refuses an address that must not be followed", () => {
    const editor = mount(light, hello, { autoFocus: "start" });
    selectRange(editor.view, 1, 6);
    editor.handle.setLink("javascript:alert(1)");
    expect(editor.handle.getText()).toBe(hello);
    editor.handle.setLink("example.com/page");
    expect(editor.handle.getText().paragraphs[0]?.runs[0]).toEqual({ t: "Hello", link: "https://example.com/page" });
    expect(editor.handle.formatState().link).toBe("https://example.com/page");
    editor.handle.setLink(null);
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Hello world" }]);
    editor.handle.setLink("slide:s-1234abcd");
    expect(editor.handle.getText().paragraphs[0]?.runs[0]).toEqual({ t: "Hello", link: "slide:s-1234abcd" });
  });

  it("selects all and types text", () => {
    const editor = mount(light, hello);
    editor.handle.selectAll();
    expect([editor.view.state.selection.from, editor.view.state.selection.to]).toEqual([1, 12]);
    editor.handle.insertText("New");
    expect(words(editor)).toEqual(["New"]);
    editor.handle.insertText("");
    expect(words(editor)).toEqual(["New"]);
  });

  it("keeps the first paragraph's settings when everything is typed over, so a placeholder stays a list", () => {
    const editor = mount(light, text({ runs: [{ t: "one", b: true }], list: "bullet", level: 1 }, p({ t: "two" })));
    editor.handle.selectAll();
    editor.handle.insertText("new");
    expect(editor.handle.getText().paragraphs).toEqual([{ runs: [{ t: "new", b: true }], list: "bullet", level: 1 }]);
  });

  it("gives focus back to the editor after each change", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    const editor = mount(light, hello, { autoFocus: "all" });
    button.focus();
    expect(editor.view.hasFocus()).toBe(false);
    editor.handle.toggleBold();
    expect(editor.view.hasFocus()).toBe(true);
    button.remove();
  });

  it("does nothing after the editor is gone, and still has the text", () => {
    const editor = mount(light, hello, { autoFocus: "all" });
    editor.handle.insertText("x");
    const { handle } = editor;
    editor.unmount();
    expect(() => {
      handle.toggleBold();
      handle.setColor("accent1");
      handle.insertText("y");
      handle.selectAll();
      handle.focus();
    }).not.toThrow();
    expect(handle.formatState()).toMatchObject({ bold: false, size: null });
  });
});
