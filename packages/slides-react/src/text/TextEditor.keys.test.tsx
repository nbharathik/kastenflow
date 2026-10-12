import type { Theme } from "@kasten-slides/wasm";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installDomShims, themeNamed } from "./test-support.ts";
import { hello, mod, mount, p, press, selectRange, text, words } from "./test-editor.tsx";

let light: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  installDomShims();
});

afterEach(cleanup);

describe("keys", () => {
  it("formats with Mod-b, Mod-i, Mod-u and Mod-Shift-x", () => {
    const editor = mount(light, hello, { autoFocus: "start" });
    selectRange(editor.view, 1, 6);
    expect(press(editor.view, "b", { ...mod, keyCode: 66 })).toBe(false);
    press(editor.view, "i", { ...mod, keyCode: 73 });
    press(editor.view, "u", { ...mod, keyCode: 85 });
    press(editor.view, "X", { ...mod, shiftKey: true, keyCode: 88 });
    expect(editor.handle.getText().paragraphs[0]?.runs[0]).toEqual({ t: "Hello", b: true, i: true, u: true, s: true });
    press(editor.view, "b", { ...mod, keyCode: 66 });
    expect(editor.handle.getText().paragraphs[0]?.runs[0]).toEqual({ t: "Hello", i: true, u: true, s: true });
  });

  it("aligns with Mod-Shift-e, l, r and j", () => {
    const editor = mount(light, hello, { autoFocus: "start" });
    const align = () => editor.handle.getText().paragraphs[0]?.align;
    press(editor.view, "E", { ...mod, shiftKey: true, keyCode: 69 });
    expect(align()).toBe("center");
    press(editor.view, "R", { ...mod, shiftKey: true, keyCode: 82 });
    expect(align()).toBe("right");
    press(editor.view, "J", { ...mod, shiftKey: true, keyCode: 74 });
    expect(align()).toBe("justify");
    press(editor.view, "L", { ...mod, shiftKey: true, keyCode: 76 });
    expect(align()).toBe("left");
  });

  it("makes lists with Mod-Shift-7 and Mod-Shift-8", () => {
    const editor = mount(light, hello, { autoFocus: "start" });
    const list = () => editor.handle.getText().paragraphs[0]?.list;
    press(editor.view, "&", { ...mod, shiftKey: true, keyCode: 55 });
    expect(list()).toBe("number");
    press(editor.view, "*", { ...mod, shiftKey: true, keyCode: 56 });
    expect(list()).toBe("bullet");
    press(editor.view, "8", { ...mod, shiftKey: true, keyCode: 56 });
    expect(list()).toBeUndefined();
    press(editor.view, "7", { ...mod, shiftKey: true, keyCode: 55 });
    expect(list()).toBe("number");
  });

  it("indents and outdents with Tab and Shift-Tab, and keeps Tab from leaving the editor", () => {
    const editor = mount(light, text({ runs: [{ t: "item" }], list: "bullet" }), { autoFocus: "start" });
    expect(press(editor.view, "Tab", { keyCode: 9 })).toBe(false);
    expect(editor.handle.getText().paragraphs[0]?.level).toBe(1);
    press(editor.view, "Tab", { keyCode: 9 });
    expect(editor.handle.getText().paragraphs[0]?.level).toBe(2);
    press(editor.view, "Tab", { shiftKey: true, keyCode: 9 });
    press(editor.view, "Tab", { shiftKey: true, keyCode: 9 });
    expect(editor.handle.getText().paragraphs[0]?.level).toBeUndefined();
    // At the outer level Shift-Tab is taken and does nothing.
    expect(press(editor.view, "Tab", { shiftKey: true, keyCode: 9 })).toBe(false);
  });

  it("splits with Enter, ends a list at an empty item, and breaks a line with Shift-Enter", () => {
    const editor = mount(light, text({ runs: [{ t: "item" }], list: "bullet" }), { autoFocus: "end" });
    press(editor.view, "Enter", { keyCode: 13 });
    expect(editor.handle.getText().paragraphs).toEqual([{ runs: [{ t: "item" }], list: "bullet" }, { runs: [{ t: "" }], list: "bullet" }]);
    press(editor.view, "Enter", { keyCode: 13 });
    expect(editor.handle.getText().paragraphs).toEqual([{ runs: [{ t: "item" }], list: "bullet" }, { runs: [{ t: "" }] }]);
    editor.handle.insertText("plain");
    press(editor.view, "Enter", { shiftKey: true, keyCode: 13 });
    editor.handle.insertText("more");
    expect(editor.handle.getText().paragraphs[1]).toEqual({ runs: [{ t: "plain\nmore" }] });
  });

  it("takes the bullet away with Backspace at the start of an item, then joins", () => {
    const editor = mount(light, text(p({ t: "one" }), { runs: [{ t: "two" }], list: "number" }), { autoFocus: "start" });
    selectRange(editor.view, 6, 6);
    press(editor.view, "Backspace", { keyCode: 8 });
    // The bullet goes and the words stay where they were: 42 units in, where a number at this size has them.
    expect(editor.handle.getText().paragraphs).toEqual([p({ t: "one" }), { runs: [{ t: "two" }], marginLeft: 42 }]);
    // Then the indent goes, and only then are the paragraphs joined.
    press(editor.view, "Backspace", { keyCode: 8 });
    expect(editor.handle.getText().paragraphs).toEqual([p({ t: "one" }), p({ t: "two" })]);
    press(editor.view, "Backspace", { keyCode: 8 });
    expect(editor.handle.getText().paragraphs).toEqual([p({ t: "onetwo" })]);
  });

  it("undoes and redoes what was done in the box, with Mod-z, Mod-y and Mod-Shift-z", () => {
    const editor = mount(light, hello, { autoFocus: "end" });
    editor.handle.insertText("!");
    expect(words(editor)).toEqual(["Hello world!"]);
    press(editor.view, "z", { ...mod, keyCode: 90 });
    expect(words(editor)).toEqual(["Hello world"]);
    expect(editor.changes.at(-1)).toEqual(hello);
    press(editor.view, "y", { ...mod, keyCode: 89 });
    expect(words(editor)).toEqual(["Hello world!"]);
    press(editor.view, "z", { ...mod, keyCode: 90 });
    press(editor.view, "Z", { ...mod, shiftKey: true, keyCode: 90 });
    expect(words(editor)).toEqual(["Hello world!"]);
  });

  it("selects everything with Mod-a", () => {
    const editor = mount(light, text(p({ t: "one" }), p({ t: "two" })), { autoFocus: "start" });
    press(editor.view, "a", { ...mod, keyCode: 65 });
    expect([editor.view.state.selection.from, editor.view.state.selection.to]).toEqual([1, 9]);
  });

  it("asks the host for an address with Mod-k, naming the link the selection is in", () => {
    const linked = text(p({ t: "see " }, { t: "this", link: "https://old.example" }));
    const editor = mount(light, linked, { autoFocus: "start" });
    selectRange(editor.view, 2, 3);
    press(editor.view, "k", { ...mod, keyCode: 75 });
    selectRange(editor.view, 7);
    press(editor.view, "k", { ...mod, keyCode: 75 });
    expect(editor.links).toEqual([null, "https://old.example"]);
    editor.handle.setLink("https://new.example");
    expect(editor.handle.getText().paragraphs[0]?.runs.at(-1)).toEqual({ t: "this", link: "https://new.example" });
  });

  it("keeps the keys it takes from the page around it, and lets the others through", () => {
    const seen: string[] = [];
    const editor = mount(light, hello, { autoFocus: "start" }, (child) => <div onKeyDown={(e) => seen.push(e.key)}>{child}</div>);
    press(editor.view, "b", { ...mod, keyCode: 66 });
    press(editor.view, "z", { ...mod, keyCode: 90 });
    press(editor.view, "x", { keyCode: 88 });
    expect(seen).toEqual(["x"]);
  });
});

describe("typing a list marker", () => {
  it("turns `- ` into a bullet and `1. ` into a number", () => {
    const editor = mount(light, text(p({ t: "" })), { autoFocus: "start" });
    editor.handle.insertText("-");
    expect(editor.view.someProp("handleTextInput", (f) => f(editor.view, 2, 2, " ", () => editor.view.state.tr))).toBe(true);
    expect(editor.handle.getText().paragraphs).toEqual([{ runs: [{ t: "" }], list: "bullet" }]);
    editor.handle.insertText("item");
    press(editor.view, "Enter", { keyCode: 13 });
    editor.handle.insertText("1.");
    const at = editor.view.state.selection.from;
    // Already a list item, so it is only a space.
    expect(editor.view.someProp("handleTextInput", (f) => f(editor.view, at, at, " ", () => editor.view.state.tr))).toBeFalsy();
  });
});

describe("undoing a list marker", () => {
  it("takes back the conversion on its own, and then the marker typed", () => {
    const editor = mount(light, text(p({ t: "" })), { autoFocus: "start" });
    editor.handle.insertText("-");
    expect(editor.view.someProp("handleTextInput", (f) => f(editor.view, 2, 2, " ", () => editor.view.state.tr))).toBe(true);
    editor.handle.insertText("item");
    expect(editor.handle.getText().paragraphs).toEqual([{ runs: [{ t: "item" }], list: "bullet" }]);
    press(editor.view, "z", { ...mod, keyCode: 90 });
    expect(editor.handle.getText().paragraphs).toEqual([{ runs: [{ t: "" }], list: "bullet" }]);
    press(editor.view, "z", { ...mod, keyCode: 90 });
    expect(editor.handle.getText().paragraphs).toEqual([p({ t: "-" })]);
    press(editor.view, "z", { ...mod, keyCode: 90 });
    expect(editor.handle.getText().paragraphs).toEqual([p({ t: "" })]);
  });
});

describe("finishing", () => {
  it("reports Escape with the text", () => {
    const editor = mount(light, hello, { autoFocus: "end" });
    editor.handle.insertText("!");
    press(editor.view, "Escape", { keyCode: 27 });
    expect(editor.dones).toHaveLength(1);
    expect(editor.dones[0]?.reason).toBe("escape");
    expect(editor.dones[0]?.text.paragraphs[0]?.runs[0]?.t).toBe("Hello world!");
  });

  it("reports a blur once, with the text", () => {
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    const editor = mount(light, hello, { autoFocus: "end" });
    editor.handle.insertText("!");
    outside.focus();
    expect(editor.dones).toHaveLength(1);
    expect(editor.dones[0]?.reason).toBe("blur");
    expect(editor.dones[0]?.text.paragraphs[0]?.runs[0]?.t).toBe("Hello world!");
    // Escape after that is not a second ending.
    press(editor.view, "Escape", { keyCode: 27 });
    expect(editor.dones).toHaveLength(1);
    outside.remove();
  });

  it("can end again after coming back", () => {
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    const editor = mount(light, hello, { autoFocus: "end" });
    outside.focus();
    editor.handle.focus();
    outside.focus();
    expect(editor.dones.map((d) => d.reason)).toEqual(["blur", "blur"]);
    outside.remove();
  });

  it("does not end when focus goes to a toolbar button", () => {
    const editor = mount(
      light,
      hello,
      { autoFocus: "end" },
      (child) => (
        <div>
          <button type="button" data-ks-keep-focus="" id="bold" />
          <button type="button" id="other" />
          {child}
        </div>
      ),
    );
    const bold = editor.container.querySelector<HTMLButtonElement>("#bold")!;
    bold.focus();
    expect(editor.dones).toEqual([]);
    editor.handle.toggleBold();
    expect(editor.view.hasFocus()).toBe(true);
    editor.container.querySelector<HTMLButtonElement>("#other")!.focus();
    expect(editor.dones.map((d) => d.reason)).toEqual(["blur"]);
  });

  it("does not end when a press on a toolbar button takes focus away without naming where it went", () => {
    const editor = mount(
      light,
      hello,
      { autoFocus: "end" },
      (child) => (
        <div>
          <button type="button" data-ks-keep-focus="" id="bold">
            <span id="icon" />
          </button>
          {child}
        </div>
      ),
    );
    fireEvent.mouseDown(editor.container.querySelector("#icon")!);
    fireEvent.blur(editor.view.dom, { relatedTarget: null });
    expect(editor.dones).toEqual([]);
    fireEvent.mouseUp(editor.container.querySelector("#icon")!);
    fireEvent.blur(editor.view.dom, { relatedTarget: null });
    expect(editor.dones.map((d) => d.reason)).toEqual(["blur"]);
  });

  it("does not report anything when it is taken away", () => {
    const editor = mount(light, hello, { autoFocus: "end" });
    editor.unmount();
    expect(editor.dones).toEqual([]);
  });
});
