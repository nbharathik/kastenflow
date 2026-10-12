// A web address pasted on an empty line or in text goes in as a link and
// opens a small menu: Link keeps it, Bookmark or Mention writes the page's
// title as the link's text. The title is read only when one of those is picked.

import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../test/editor";
import type { LinkProvider } from "./links";
import { pasteAddress } from "./paste-link";
import { titleFor } from "./paste-link-menu";

const URL = "https://example.com/a";
const webTitle = vi.fn(async (_url: string): Promise<string | null> => "Example Domain");
const links: LinkProvider = { pages: () => [], open: vi.fn(), webTitle: (url) => webTitle(url) };
const editor = useTestEditor({ links });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const items = () => [...document.querySelectorAll<HTMLElement>(".kasten-menu .kasten-menu-item")];
const keys = () => items().map((item) => item.dataset.key);
const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const cards = () => [...editor.view.dom.querySelectorAll<HTMLElement>("p.kasten-bookmark")];

/** Pastes `text` at the caret; true when the editor took it. */
function paste(text: string): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [], getData: () => text } });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

/** An empty page with the caret in it. */
function emptyPage() {
  editor.open("\n");
  const { view } = editor;
  view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)));
}

afterEach(() => {
  press("Escape");
  document.querySelector(".kasten-menu")?.remove();
  vi.clearAllMocks();
  webTitle.mockImplementation(async () => "Example Domain");
});

describe("an address pasted on an empty line", () => {
  it("goes in as a plain link, and a menu offers Link and Bookmark without reading the page", () => {
    emptyPage();
    expect(paste(` ${URL}\n`)).toBe(true);
    const paragraph = editor.doc.firstChild!;
    expect(paragraph.textContent).toBe(URL);
    expect(paragraph.firstChild!.marks.map((m) => [m.type.name, m.attrs.href])).toEqual([["link", URL]]);
    expect(keys()).toEqual(["link", "bookmark"]);
    expect(items()[0]!.classList.contains("is-selected")).toBe(true);
    expect(webTitle).not.toHaveBeenCalled();
    // Esc keeps it as a link, and nothing is read.
    press("Escape");
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(editor.doc.firstChild!.textContent).toBe(URL);
    expect(webTitle).not.toHaveBeenCalled();
    expect(editor.save()).toContain(URL);
  });

  it("becomes a bookmark card with the page's title when Bookmark is picked", async () => {
    emptyPage();
    paste(URL);
    items()[1]!.click();
    expect(webTitle).toHaveBeenCalledWith(URL);
    await settle();
    expect(editor.save()).toBe(`[Example Domain](${URL})\n`);
    expect(cards().map((c) => [c.textContent, c.dataset.domain])).toEqual([["Example Domain", "example.com"]]);
    // Writing goes on in a line below the card, which the file does not keep until it is typed in.
    expect(editor.doc.childCount).toBe(2);
    expect(editor.doc.lastChild!.content.size).toBe(0);
    expect(editor.view.state.selection.$from.parent).toBe(editor.doc.lastChild);
    editor.type("Next");
    expect(editor.save()).toBe(`[Example Domain](${URL})\n\nNext\n`);
  });

  it("is picked from the keyboard, and Enter on Link just closes the menu", async () => {
    emptyPage();
    paste(URL);
    press("Enter");
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(webTitle).not.toHaveBeenCalled();
    editor.open("\n");
    emptyPage();
    paste(URL);
    press("ArrowDown");
    press("Enter");
    await settle();
    expect(editor.save()).toBe(`[Example Domain](${URL})\n`);
  });

  it("falls back to the site's name when the page cannot be read or has no title", async () => {
    emptyPage();
    webTitle.mockRejectedValue(new Error("offline"));
    paste("https://www.example.com/a");
    items()[1]!.click();
    await settle();
    expect(editor.save()).toBe("[example.com](https://www.example.com/a)\n");
    expect(await titleFor({ pages: () => [], open: vi.fn() }, URL)).toBe("example.com");
    // A page without a title of its own is named by its address.
    expect(await titleFor({ pages: () => [], open: vi.fn(), webTitle: async () => "example.com/a" }, URL)).toBe("example.com");
    expect(await titleFor({ pages: () => [], open: vi.fn(), webTitle: async () => "  Two \n lines  " }, URL)).toBe("Two lines");
  });

  it("writes a title with brackets so it reads back the same", async () => {
    emptyPage();
    webTitle.mockResolvedValue("A [b] c");
    paste(URL);
    items()[1]!.click();
    await settle();
    expect(editor.save()).toBe(`[A \\[b\\] c](${URL})\n`);
    expect(editor.doc.firstChild!.textContent).toBe("A [b] c");
  });

  it("leaves the page alone when it was edited while the title was read", async () => {
    emptyPage();
    let answer: (title: string) => void = () => {};
    webTitle.mockImplementation(() => new Promise<string>((resolve) => (answer = resolve)));
    paste(URL);
    items()[1]!.click();
    // The address is written over while waiting.
    const { view } = editor;
    view.dispatch(view.state.tr.insertText("x", 4));
    answer("Example Domain");
    await settle();
    expect(editor.doc.firstChild!.textContent).toContain("x");
    expect(editor.doc.firstChild!.textContent).not.toContain("Example Domain");
  });
});

describe("an address pasted in text", () => {
  it("goes in as a link and offers Link and Mention", async () => {
    editor.open("See\n");
    editor.caret("See", true);
    paste(URL);
    expect(keys()).toEqual(["link", "mention"]);
    items()[1]!.click();
    await settle();
    expect(editor.save()).toBe(`See[Example Domain](${URL})\n`);
    // Inside text it is a mention, not a card.
    expect(cards()).toHaveLength(0);
  });

  it("offers Mention, not Bookmark, in a list item, where a card is not drawn", () => {
    editor.open("- \n");
    const { view } = editor;
    view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)));
    paste(URL);
    expect(keys()).toEqual(["link", "mention"]);
  });

  it("closes the menu and lets the typing through when you go on writing", () => {
    editor.open("See\n");
    editor.caret("See", true);
    paste(URL);
    press("a");
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(webTitle).not.toHaveBeenCalled();
  });
});

describe("what is not offered", () => {
  it("pastes as it always did over selected text, in code, and for anything but a lone web address", () => {
    editor.open("Read the guide first.\n");
    const { view } = editor;
    const from = editor.doc.firstChild!.firstChild ? 1 + "Read ".length : 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + "the guide".length)));
    expect(paste(URL)).toBe(true);
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(editor.save()).toBe(`Read [the guide](${URL}) first.\n`);
    // Not a lone address, not a web address, inside code (the editor's own paste takes those).
    const offered = (text: string) => pasteAddress(view, editor.ctx, text);
    editor.open("See\n");
    editor.caret("See", true);
    expect(offered(`${URL} and more`)).toBe(false);
    expect(offered("mailto:a@example.com")).toBe(false);
    expect(offered("javascript:alert(1)")).toBe(false);
    editor.open("```\ncode\n```\n");
    view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)));
    expect(offered(URL)).toBe(false);
    // Nor with the caret inside a link already.
    editor.open(`[the guide](${URL})\n`);
    editor.caret("guide");
    expect(offered("https://example.org")).toBe(false);
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(editor.save()).toBe(`[the guide](${URL})\n`);
  });
});
