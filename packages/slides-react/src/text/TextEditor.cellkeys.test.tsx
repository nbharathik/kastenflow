// The editor in a cell of a table: Tab, Shift+Tab and Enter belong to the table, Shift+Enter is the paragraph break, and the arrows
// and everything else stay the text's.

import type { Theme } from "@kasten-slides/wasm";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installDomShims, themeNamed } from "./test-support.ts";
import { hello, mount, press, selectRange, text, words, p } from "./test-editor.tsx";

let light: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  installDomShims();
});

afterEach(cleanup);

function keyed() {
  const calls: string[] = [];
  return { calls, cellKeys: { tab: (back: boolean) => calls.push(back ? "back" : "forward"), enter: () => calls.push("enter") } };
}

describe("an editor with cell keys", () => {
  it("gives Tab and Shift+Tab to the table, and does not indent", () => {
    const { calls, cellKeys } = keyed();
    const editor = mount(light, text({ runs: [{ t: "item" }], list: "bullet" }), { autoFocus: "start", cellKeys });
    expect(press(editor.view, "Tab", { keyCode: 9 })).toBe(false);
    expect(press(editor.view, "Tab", { shiftKey: true, keyCode: 9 })).toBe(false);
    expect(calls).toEqual(["forward", "back"]);
    expect(editor.handle.getText().paragraphs[0]?.level).toBeUndefined();
  });

  it("gives Enter to the table, and makes no new paragraph", () => {
    const { calls, cellKeys } = keyed();
    const editor = mount(light, hello, { autoFocus: "end", cellKeys });
    expect(press(editor.view, "Enter", { keyCode: 13 })).toBe(false);
    expect(calls).toEqual(["enter"]);
    expect(words(editor)).toEqual(["Hello world"]);
  });

  it("breaks the paragraph with Shift+Enter, as Enter does in a text box", () => {
    const { calls, cellKeys } = keyed();
    const editor = mount(light, hello, { autoFocus: "end", cellKeys });
    press(editor.view, "Enter", { shiftKey: true, keyCode: 13 });
    expect(calls).toEqual([]);
    expect(words(editor)).toEqual(["Hello world", ""]);
    editor.handle.insertText("next");
    expect(words(editor)).toEqual(["Hello world", "next"]);
  });

  it("leaves the arrows, Home and End to the text, which moves the caret inside the cell", () => {
    const { calls, cellKeys } = keyed();
    const editor = mount(light, text(p({ t: "one" }), p({ t: "two" })), { autoFocus: "start", cellKeys });
    selectRange(editor.view, 2);
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) press(editor.view, key);
    expect(calls).toEqual([]);
    expect(words(editor)).toEqual(["one", "two"]);
  });

  it("still escapes: Escape ends the edit, with the reason", () => {
    const { cellKeys } = keyed();
    const editor = mount(light, hello, { autoFocus: "end", cellKeys });
    press(editor.view, "Escape", { keyCode: 27 });
    expect(editor.dones).toEqual([{ text: hello, reason: "escape" }]);
  });

  it("calls the newest keys the host gave, as the other callbacks do", () => {
    const first = keyed();
    const second = keyed();
    const editor = mount(light, hello, { autoFocus: "end", cellKeys: first.cellKeys });
    editor.rerender({ cellKeys: second.cellKeys });
    press(editor.view, "Enter", { keyCode: 13 });
    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual(["enter"]);
  });

  it("is the text box's editor without them: Tab indents and Enter splits", () => {
    const editor = mount(light, text({ runs: [{ t: "item" }], list: "bullet" }), { autoFocus: "end" });
    press(editor.view, "Tab", { keyCode: 9 });
    expect(editor.handle.getText().paragraphs[0]?.level).toBe(1);
    press(editor.view, "Enter", { keyCode: 13 });
    expect(editor.handle.getText().paragraphs).toHaveLength(2);
  });
});
