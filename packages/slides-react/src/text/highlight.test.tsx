// The colour behind the words: a mark like colour and size, in the editor, in the drawing, and through the deck's format.

import type { Theme } from "@kasten-slides/wasm";
import { cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TextBlock } from "./TextBlock.tsx";
import { docToText, textToDoc } from "./convert.ts";
import { createTextSchema } from "./schema.ts";
import { installDomShims, themeNamed } from "./test-support.ts";
import { hello, mod, mount, p, press, selectRange, text } from "./test-editor.tsx";

let light: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  installDomShims();
});

afterEach(cleanup);

describe("a highlight on the selected words", () => {
  it("is put behind them and taken away again, and only the words selected have it", () => {
    const editor = mount(light, hello, { autoFocus: "start" });
    selectRange(editor.view, 1, 6);
    editor.handle.setHighlight("accent3");
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Hello", highlight: "accent3" }, { t: " world" }]);
    editor.handle.setHighlight(null);
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Hello world" }]);
  });

  it("takes a colour as a hex value as well, and ignores what is not a colour", () => {
    const editor = mount(light, hello, { autoFocus: "start" });
    selectRange(editor.view, 1, 6);
    editor.handle.setHighlight("#ffee00");
    expect(editor.handle.getText().paragraphs[0]?.runs[0]).toEqual({ t: "Hello", highlight: "#ffee00" });
    editor.handle.setHighlight("yellow");
    expect(editor.handle.getText().paragraphs[0]?.runs[0]).toEqual({ t: "Hello", highlight: "#ffee00" });
  });

  it("is drawn as a ground behind the words in the editor", () => {
    const editor = mount(light, text(p({ t: "marked", highlight: "accent3" }, { t: " plain" })), { autoFocus: "start" });
    const spans = [...editor.container.querySelectorAll<HTMLElement>('[data-ks="highlight"]')];
    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe("marked");
    expect(spans[0]?.style.background).toBe("rgb(251, 188, 4)");
    expect(spans[0]?.dataset.v).toBe("accent3");
  });

  it("is on the words typed next when it is set at a caret", () => {
    const editor = mount(light, hello, { autoFocus: "end" });
    editor.handle.setHighlight("accent3");
    editor.handle.insertText("!");
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Hello world" }, { t: "!", highlight: "accent3" }]);
  });

  it("says what the selection has: the colour, none, or mixed", () => {
    const editor = mount(light, text(p({ t: "one", highlight: "accent3" }, { t: " two" })), { autoFocus: "start" });
    selectRange(editor.view, 1, 4);
    expect(editor.handle.formatState().highlight).toBe("accent3");
    selectRange(editor.view, 5, 8);
    expect(editor.handle.formatState().highlight).toBeNull();
    selectRange(editor.view, 1, 8);
    expect(editor.handle.formatState().highlight).toBe("mixed");
  });

  it("goes with Clear formatting", () => {
    const editor = mount(light, text(p({ t: "marked", highlight: "accent3", b: true })), { autoFocus: "start" });
    selectRange(editor.view, 1, 7);
    press(editor.view, "\\", { ...mod, keyCode: 220 });
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "marked" }]);
  });

  it("is kept by an empty paragraph, so words typed there look as set", () => {
    const editor = mount(light, text(p({ t: "" })), { autoFocus: "start" });
    editor.handle.setHighlight("accent3");
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "", highlight: "accent3" }]);
  });

  it("makes a highlight inside inline code win over the code's ground", () => {
    const editor = mount(light, text(p({ t: "x", code: true, highlight: "#ffee00" })), { autoFocus: "start" });
    const code = editor.container.querySelector<HTMLElement>('[data-ks="code"]');
    const marked = editor.container.querySelector<HTMLElement>('[data-ks="highlight"]');
    expect(code).not.toBeNull();
    expect(marked?.closest('[data-ks="code"]')).toBe(code);
    expect(marked?.style.background).toBe("rgb(255, 238, 0)");
  });
});

describe("a highlight through the document", () => {
  it("comes back from the editor's document as it went in, the very same paragraph", () => {
    const schema = createTextSchema(light, "body");
    const given = text(p({ t: "a", highlight: "accent3" }, { t: "b" }, { t: "c", highlight: "#ffee00", b: true }));
    const doc = textToDoc(given, schema);
    expect(docToText(doc, given)).toBe(given);
    expect(docToText(doc, text()).paragraphs).toEqual(given.paragraphs);
  });
});

describe("a highlight in the drawing of the slide", () => {
  it("is a ground behind the words of the run", () => {
    const html = renderToStaticMarkup(<TextBlock theme={light} text={text(p({ t: "marked", highlight: "accent3" }))} baseStyle="body" width={600} height={300} />);
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const found = [...holder.querySelectorAll<HTMLElement>("span")].find((span) => span.style.background !== "");
    expect(found?.textContent).toBe("marked");
    expect(found?.style.background).toBe("rgb(251, 188, 4)");
  });
});
