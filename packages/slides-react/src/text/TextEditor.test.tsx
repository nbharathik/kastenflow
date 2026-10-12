import type { Paragraph, Text, Theme } from "@kasten-slides/wasm";
import { cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TextBlock } from "./TextBlock.tsx";
import { installDomShims, themeNamed } from "./test-support.ts";
import { hello, mount, p, selectRange, styleOf, text } from "./test-editor.tsx";

let light: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  installDomShims();
});

afterEach(cleanup);

describe("the box", () => {
  it("is the box of the read-only drawing", () => {
    const boxed: Text = { ...hello, valign: "middle", insets: { left: 5, top: 6, right: 7, bottom: 8 } };
    const editor = mount(light, boxed);
    const drawn = document.createElement("div");
    drawn.innerHTML = renderToStaticMarkup(<TextBlock theme={light} text={boxed} baseStyle="body" width={600} height={200} />);
    const root = drawn.firstElementChild as HTMLElement;
    const editing = editor.view.dom;
    expect(styleOf(editing)).toEqual(styleOf(root));
    expect(editing.classList.contains("ks-text")).toBe(true);
    expect(styleOf(editing)["padding"]).toBe("6px 7px 8px 5px");
    expect(styleOf(editing)["justify-content"]).toBe("center");
  });

  it("takes insets and valign from its props when the text names none", () => {
    const editor = mount(light, hello, { insets: { left: 1, top: 2, right: 3, bottom: 4 }, valign: "bottom" });
    expect(styleOf(editor.view.dom)["padding"]).toBe("2px 3px 4px 1px");
    expect(styleOf(editor.view.dom)["justify-content"]).toBe("flex-end");
    expect(styleOf(mount(light, hello).view.dom)["padding"]).toBe("4.8px 9.6px");
  });

  it("follows a box that is moved or resized", () => {
    const editor = mount(light, hello);
    editor.rerender({ width: 300, height: 100, valign: "middle" });
    expect(styleOf(editor.view.dom)).toMatchObject({ width: "300px", height: "100px", "justify-content": "center" });
  });

  it("draws every paragraph as the read-only drawing does", () => {
    const rich = text(
      { runs: [{ t: "One " }, { t: "two", b: true, size: 16 }], list: "bullet", spaceAfter: 5 },
      { runs: [{ t: "Three", color: "accent2" }], list: "number", level: 1, align: "center" },
      p({ t: "" }),
    );
    const editor = mount(light, rich);
    const drawn = document.createElement("div");
    drawn.innerHTML = renderToStaticMarkup(<TextBlock theme={light} text={rich} baseStyle="body" width={600} height={200} />);
    const shown = [...drawn.querySelectorAll(".ks-p")];
    const editing = [...editor.view.dom.querySelectorAll(".ks-p")];
    expect(editing).toHaveLength(shown.length);
    shown.forEach((paragraph, i) => {
      expect(styleOf(editing[i]!), `paragraph ${i}`).toEqual(styleOf(paragraph));
      expect(editing[i]!.textContent).toBe(paragraph.textContent === "" ? "" : paragraph.textContent!.replace(/^(●|○|■|\d+\.|[a-z]+\.)/, ""));
    });
    // The marker is the paragraph's data-marker here, and a span there.
    expect(editing.map((e) => e.getAttribute("data-marker"))).toEqual(["●", "a.", null]);
    expect([...drawn.querySelectorAll(".ks-marker")].map((e) => e.textContent)).toEqual(["●", "a."]);
  });
});

describe("starting", () => {
  it("puts the caret at the start, at the end, or selects everything", () => {
    const two = text(p({ t: "one" }), p({ t: "two" }));
    const start = mount(light, two, { autoFocus: "start" });
    expect([start.view.state.selection.from, start.view.state.selection.to]).toEqual([1, 1]);
    expect(start.view.hasFocus()).toBe(true);
    cleanup();
    const end = mount(light, two, { autoFocus: "end" });
    expect([end.view.state.selection.from, end.view.state.selection.to]).toEqual([9, 9]);
    cleanup();
    const all = mount(light, two, { autoFocus: "all" });
    expect([all.view.state.selection.from, all.view.state.selection.to]).toEqual([1, 9]);
  });

  it("leaves focus alone without autoFocus", () => {
    const editor = mount(light, hello);
    expect(editor.view.hasFocus()).toBe(false);
  });

  it("tells the host how the selection is formatted when it starts", () => {
    const editor = mount(light, hello, { autoFocus: "end" });
    expect(editor.formats.length).toBeGreaterThan(0);
    expect(editor.formats.at(-1)).toMatchObject({ bold: false, align: "left" });
  });

  it("gives back the text it was given until something is typed", () => {
    const original = text(p({ t: "a", b: true }, { t: "", i: true }, { t: "b" }), { runs: [{ t: "c" }], bullet: "x" } as Paragraph);
    const editor = mount(light, original);
    expect(editor.handle.getText()).toBe(original);
  });
});

describe("changing the words", () => {
  it("reports the text after each change, and keeps what was not touched", () => {
    const original = text(p({ t: "keep", b: true }, { t: "", i: true }), p({ t: "edit me" }));
    const editor = mount(light, original, { autoFocus: "end" });
    editor.handle.insertText("!");
    expect(editor.changes).toHaveLength(1);
    const changed = editor.changes[0]!;
    expect(changed.paragraphs[0]).toBe(original.paragraphs[0]);
    expect(changed.paragraphs[1]).toEqual(p({ t: "edit me!" }));
    editor.handle.insertText("?");
    expect(editor.changes.at(-1)?.paragraphs[1]).toEqual(p({ t: "edit me!?" }));
  });

  it("reports nothing for a move of the caret", () => {
    const editor = mount(light, hello, { autoFocus: "start" });
    selectRange(editor.view, 3, 5);
    expect(editor.changes).toEqual([]);
  });

  it("reports the formatting when the selection or the marks change, and only when it differs", () => {
    const editor = mount(light, text(p({ t: "ab", b: true }, { t: "cd" })), { autoFocus: "start" });
    const before = editor.formats.length;
    selectRange(editor.view, 1, 2);
    expect(editor.formats.at(-1)).toMatchObject({ bold: true });
    selectRange(editor.view, 1, 5);
    expect(editor.formats.at(-1)).toMatchObject({ bold: "mixed" });
    const after = editor.formats.length;
    selectRange(editor.view, 1, 5);
    expect(editor.formats).toHaveLength(after);
    expect(after).toBeGreaterThan(before);
    editor.handle.toggleItalic();
    expect(editor.formats.at(-1)).toMatchObject({ bold: "mixed", italic: true });
  });
});
