import type { Paragraph, Text, Theme } from "@kasten-slides/wasm";
import { cleanup, render } from "@testing-library/react";
import { StrictMode, createRef } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TextEditor, type TextEditorHandle } from "./TextEditor.tsx";
import { sanitizeCopiedHtml } from "./paste.ts";
import { installDomShims, themeNamed } from "./test-support.ts";
import { mount, press, selectRange } from "./test-editor.tsx";

let light: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  installDomShims();
});

afterEach(cleanup);

const p = (...runs: Paragraph["runs"]): Paragraph => ({ runs });
const text = (...paragraphs: Paragraph[]): Text => ({ paragraphs });
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

describe("list markers", () => {
  it("are the list's own numbers, and follow when an item goes", () => {
    const editor = mount(light, text({ runs: [{ t: "a" }], list: "number" }, { runs: [{ t: "b" }], list: "number" }, { runs: [{ t: "c" }], list: "number" }, { runs: [{ t: "d" }], list: "bullet" }));
    const markers = () => [...editor.view.dom.querySelectorAll(".ks-p")].map((element) => element.getAttribute("data-marker"));
    expect(markers()).toEqual(["1.", "2.", "3.", "●"]);
    const second = editor.view.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.view.state.tr.delete(second, second + editor.view.state.doc.child(1).nodeSize));
    expect(markers()).toEqual(["1.", "2.", "●"]);
    editor.handle.selectAll();
    editor.handle.toggleList("number");
    expect(markers()).toEqual(["1.", "2.", "3."]);
    editor.handle.toggleList("number");
    expect(markers()).toEqual([null, null, null]);
  });

  it("take the look of the first run, and the paragraph measures its lines by its runs", () => {
    const editor = mount(light, text({ runs: [{ t: "Item" }], list: "bullet" }));
    const paragraph = () => editor.view.dom.querySelector<HTMLElement>(".ks-p")!;
    expect(paragraph().style.getPropertyValue("--ks-marker-size")).toBe("29.333px");
    expect(paragraph().style.fontSize).toBe("29.333px");
    editor.handle.selectAll();
    editor.handle.setSize(16);
    editor.handle.setColor("accent2");
    editor.handle.toggleBold();
    expect(paragraph().style.getPropertyValue("--ks-marker-size")).toBe("21.333px");
    expect(paragraph().style.getPropertyValue("--ks-marker-color")).toBe("#ea4335");
    expect(paragraph().style.getPropertyValue("--ks-marker-weight")).toBe("700");
    expect(paragraph().style.fontSize).toBe("21.333px");
    editor.handle.setSize(null);
    expect(paragraph().style.fontSize).toBe("29.333px");
  });

  it("do not end up in the text", () => {
    const editor = mount(light, text({ runs: [{ t: "Item" }], list: "bullet" }));
    expect(editor.view.dom.textContent).toBe("Item");
    expect(editor.handle.getText().paragraphs[0]?.runs).toEqual([{ t: "Item" }]);
  });
});

describe("the marker of an empty item", () => {
  const sized = text({ runs: [{ t: "How are you", size: 12 }], list: "bullet" }, { runs: [{ t: "", size: 12 }], list: "bullet" });
  const paragraphs = (editor: ReturnType<typeof mount>) => [...editor.view.dom.querySelectorAll<HTMLElement>(".ks-p")];

  it("is as large as the one above it when the empty item has the same size", () => {
    const [first, second] = paragraphs(mount(light, sized));
    expect(second!.style.getPropertyValue("--ks-marker-size")).toBe(first!.style.getPropertyValue("--ks-marker-size"));
    expect(second!.style.getPropertyValue("--ks-marker-size")).toBe("16px");
    expect(second!.style.fontSize).toBe(first!.style.fontSize);
  });

  it("follows a size set on everything, empty items included, and keeps it in the text", () => {
    const editor = mount(light, text({ runs: [{ t: "How are you" }], list: "bullet" }, { runs: [{ t: "" }], list: "bullet" }));
    editor.handle.selectAll();
    editor.handle.setSize(20);
    const [first, second] = paragraphs(editor);
    expect(second!.style.getPropertyValue("--ks-marker-size")).toBe("26.667px");
    expect(first!.style.getPropertyValue("--ks-marker-size")).toBe("26.667px");
    expect(second!.style.fontSize).toBe("26.667px");
    expect(editor.handle.getText().paragraphs.map((paragraph) => paragraph.runs)).toEqual([[{ t: "How are you", size: 20 }], [{ t: "", size: 20 }]]);
    editor.handle.setColor("accent2");
    expect(editor.handle.getText().paragraphs[1]?.runs).toEqual([{ t: "", size: 20, color: "accent2" }]);
    // A paragraph whose settings change is drawn again, so it is asked for again.
    expect(paragraphs(editor).map((paragraph) => paragraph.style.getPropertyValue("--ks-marker-color"))).toEqual(["#ea4335", "#ea4335"]);
  });

  it("is drawn in the look of the line it came from when Enter makes it", () => {
    const editor = mount(light, text({ runs: [{ t: "How are you", size: 12 }], list: "bullet" }), { autoFocus: "end" });
    press(editor.view, "Enter");
    const [first, second] = paragraphs(editor);
    expect(second!.style.getPropertyValue("--ks-marker-size")).toBe(first!.style.getPropertyValue("--ks-marker-size"));
    expect(editor.handle.getText().paragraphs[1]).toEqual({ runs: [{ t: "", size: 12 }], list: "bullet" });
    editor.handle.insertText("fine");
    expect(editor.handle.getText().paragraphs[1]).toEqual({ runs: [{ t: "fine", size: 12 }], list: "bullet" });
  });

  it("is made larger or smaller than its words by a share of them, in every selected item", () => {
    const editor = mount(light, text({ runs: [{ t: "a" }], list: "bullet" }, { runs: [{ t: "" }], list: "bullet" }));
    editor.handle.selectAll();
    editor.handle.setBulletSize(1.5);
    expect(paragraphs(editor).map((paragraph) => paragraph.style.getPropertyValue("--ks-marker-size"))).toEqual(["44px", "44px"]);
    expect(editor.handle.getText().paragraphs.map((paragraph) => paragraph.bulletSize)).toEqual([1.5, 1.5]);
    expect(editor.handle.formatState().bulletSize).toBe(1.5);
    editor.handle.setBulletSize(null);
    expect(paragraphs(editor).map((paragraph) => paragraph.style.getPropertyValue("--ks-marker-size"))).toEqual(["29.333px", "29.333px"]);
    editor.handle.setBulletColor("accent2");
    expect(editor.handle.getText().paragraphs.map((paragraph) => paragraph.bulletColor)).toEqual(["accent2", "accent2"]);
    editor.handle.setBulletColor("not a colour");
    expect(editor.handle.getText().paragraphs.map((paragraph) => paragraph.bulletColor)).toEqual(["accent2", "accent2"]);
  });
});

describe("the page elements", () => {
  it("stay the same elements while someone types or formats, so an input method is not cut off", () => {
    const editor = mount(light, text({ runs: [{ t: "Item" }], list: "bullet" }, p({ t: "Second" })), { autoFocus: "end" });
    const before = [...editor.view.dom.querySelectorAll(".ks-p")];
    editor.handle.insertText(" typed");
    editor.handle.selectAll();
    editor.handle.setSize(20);
    editor.handle.setColor("accent1");
    editor.handle.toggleBold();
    const after = [...editor.view.dom.querySelectorAll(".ks-p")];
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it("keep the paragraph element when its runs change size", () => {
    const editor = mount(light, text({ runs: [{ t: "Item" }], list: "bullet" }), { autoFocus: "end" });
    const before = editor.view.dom.querySelector(".ks-p");
    editor.handle.selectAll();
    editor.handle.setSize(30);
    editor.handle.setSize(12);
    expect(editor.view.dom.querySelector(".ks-p")).toBe(before);
  });
});

describe("reading the page back", () => {
  it("keeps every mark when the browser changes the text inside them, but not the link for words added after it", async () => {
    const styled = { t: "styled", b: true, i: true, color: "accent2", size: 30, link: "https://x.y" };
    const original = text(p({ t: "Plain " }, styled, { t: " end" }));
    const middle = mount(light, original, { autoFocus: "start" });
    (middle.view.dom.querySelector("a")!.firstChild as unknown as globalThis.Text).nodeValue = "sty!led";
    await settle();
    expect(middle.handle.getText().paragraphs).toEqual([p({ t: "Plain " }, { ...styled, t: "sty!led" }, { t: " end" })]);
    cleanup();
    const end = mount(light, original, { autoFocus: "start" });
    (end.view.dom.querySelector("a")!.firstChild as unknown as globalThis.Text).nodeValue = "styled!";
    await settle();
    expect(end.handle.getText().paragraphs).toEqual([p({ t: "Plain " }, styled, { t: "!", b: true, i: true, color: "accent2", size: 30 }, { t: " end" })]);
  });

  it("keeps a paragraph's settings when the browser changes its text", async () => {
    const original = text({ runs: [{ t: "item" }], list: "number", level: 1, align: "center", lineSpacing: 1.5, bullet: "x" } as Paragraph);
    const editor = mount(light, original, { autoFocus: "start" });
    const node = editor.view.dom.querySelector(".ks-p")!.firstChild as unknown as globalThis.Text;
    node.nodeValue = "items";
    await settle();
    expect(editor.handle.getText().paragraphs).toEqual([{ runs: [{ t: "items" }], list: "number", level: 1, align: "center", lineSpacing: 1.5, bullet: "x" }]);
  });

  it("keeps a line break the browser writes as a new line in the text", async () => {
    const editor = mount(light, text(p({ t: "ab" })), { autoFocus: "start" });
    const node = editor.view.dom.querySelector(".ks-p")!.firstChild as unknown as globalThis.Text;
    node.nodeValue = "a\nb";
    await settle();
    expect(editor.handle.getText().paragraphs).toEqual([p({ t: "a\nb" })]);
  });
});

describe("what leaves the editor and comes back", () => {
  const html = (run: string) => `<meta charset="utf-8"><div data-pm-slice="1 1 []"><div data-ks-p="{}" class="ks-p">${run}</div></div>`;

  it("loses a link that must not be followed and a colour that is not one, and keeps the words", () => {
    const dirty = html('<a data-ks="link" data-v="javascript:alert(1)" href="javascript:alert(1)">bad</a> <span data-ks="color" data-v="url(x)">c</span>');
    const clean = sanitizeCopiedHtml(dirty, light);
    expect(clean).not.toContain("javascript");
    expect(clean).not.toContain('data-ks="color"');
    expect(clean).toContain("bad");
    expect(clean).toContain("bad c");
    expect(clean).toContain("data-pm-slice");
  });

  it("keeps a link and a colour that are fine, and touches nothing else", () => {
    const fine = html('<a data-ks="link" data-v="https://x.y">ok</a> <span data-ks="color" data-v="accent1">c</span> <span data-ks="color" data-v="#ff0000">r</span>');
    const clean = sanitizeCopiedHtml(fine, light);
    expect(clean).toContain('data-v="https://x.y"');
    expect(clean).toContain('data-v="accent1"');
    expect(clean).toContain('data-v="#ff0000"');
    const other = "<p>Nothing of ours here</p>";
    expect(sanitizeCopiedHtml(other, light)).toBe(other);
  });

  it("puts a link on the clipboard with an address for other programs, and lines apart with one break", () => {
    const editor = mount(light, text(p({ t: "see " }, { t: "this", link: "https://x.y" }), p({ t: "next" })), { autoFocus: "start" });
    selectRange(editor.view, 1, editor.view.state.doc.content.size - 1);
    const { dom, text: plain } = editor.view.serializeForClipboard(editor.view.state.selection.content());
    const holder = document.createElement("div");
    holder.appendChild(dom);
    expect(holder.querySelector("a")?.getAttribute("href")).toBe("https://x.y");
    expect(plain).toBe("see this\nnext");
  });
});

describe("the component", () => {
  it("works when React mounts it twice, as it does in development", () => {
    const ref = createRef<TextEditorHandle>();
    const changes: Text[] = [];
    const { container } = render(
      <StrictMode>
        <TextEditor theme={light} text={text(p({ t: "Hi" }))} baseStyle="body" width={300} height={100} handleRef={ref} autoFocus="end" onChange={(t) => changes.push(t)} />
      </StrictMode>,
    );
    expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    ref.current?.insertText("!");
    expect(ref.current?.getText().paragraphs[0]?.runs[0]?.t).toBe("Hi!");
    expect(changes).toHaveLength(1);
  });

  it("removes itself and its listeners when it goes", () => {
    const editor = mount(light, text(p({ t: "Hi" })), { autoFocus: "end" });
    const host = editor.view.dom.parentElement!;
    editor.unmount();
    expect(document.contains(host)).toBe(false);
    expect(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }).not.toThrow();
  });

  it("takes a class of the caller's", () => {
    const editor = mount(light, text(p({ t: "Hi" })), { className: "mine" });
    expect(editor.container.querySelector(".ks-text-editor.mine")).not.toBeNull();
  });
});
