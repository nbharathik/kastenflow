// Links alone on their line: a page link is a page block (an embed, with
// `!`), a web link with a title is a bookmark card. Both are drawn only for a
// page's own blocks, never inside a list item or a quote, where a link is
// part of the text.

import { describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import type { LinkProvider } from "../links";
import { bookmarkOf } from "./bookmark-view";

const links: LinkProvider = { pages: () => [{ title: "Trip plan" }], open: vi.fn() };
const editor = useTestEditor({ links });

const blocks = () => [...editor.view.dom.querySelectorAll<HTMLElement>(".kasten-mention")].map((m) => m.classList.contains("is-block"));
const cards = () => [...editor.view.dom.querySelectorAll<HTMLElement>("p.kasten-bookmark")];

describe("page links alone on a line", () => {
  it("are page blocks among a page's blocks, and plain mentions in list items and quotes", () => {
    const body = "[[Trip plan]]\n\n- [ ] [[2026-10-01]]\n\n- [[Trip plan]]\n\n> [[Trip plan]]\n";
    editor.open(body);
    expect(blocks()).toEqual([true, false, false, false]);
    // Only the page block says what a missing page is, as a block.
    expect(editor.view.dom.textContent).not.toContain("A new page. Click to start it");
    expect(editor.save()).toBe(body);
  });

  it("stay page blocks inside a toggle", () => {
    editor.open("<details>\n<summary>More</summary>\n\n[[Trip plan]]\n\n</details>\n");
    expect(blocks()).toEqual([true]);
  });

  it("stop being page blocks when text joins them, and start again when it leaves", () => {
    editor.open("[[Trip plan]]\n");
    expect(blocks()).toEqual([true]);
    const { view } = editor;
    const end = view.state.doc.firstChild!.nodeSize - 1;
    view.dispatch(view.state.tr.insertText(" and more", end));
    expect(blocks()).toEqual([false]);
    view.dispatch(view.state.tr.delete(end, end + " and more".length));
    expect(blocks()).toEqual([true]);
  });
});

describe("bookmark cards", () => {
  it("read the address of a link whose text is not that address", () => {
    expect(bookmarkOf("Example site", "https://www.example.com/a/b")).toEqual({ domain: "example.com" });
    expect(bookmarkOf("https://example.com", "https://example.com")).toBeNull();
    expect(bookmarkOf("Notes", "../pages/notes.md")).toBeNull();
    expect(bookmarkOf("Mail me", "mailto:a@example.com")).toBeNull();
    expect(bookmarkOf("Odd", "https://")).toBeNull();
  });

  it("draw a lone titled web link as a card, without changing the page", () => {
    const body = "[Example site](https://www.example.com/a/b)\n\nhttps://example.com\n\n- [Item](https://example.com/c)\n\nText [inline](https://example.com) here\n\n[One](https://a.example) [Two](https://b.example)\n";
    editor.open(body);
    expect(cards().map((c) => [c.textContent, c.dataset.domain])).toEqual([["Example site", "example.com"]]);
    expect(editor.save()).toBe(body);
  });

  it("show the link as written while the caret is in it, and the card again after", () => {
    editor.open("[Example site](https://example.com)\n\nAfter.\n");
    // A page that is not being written in keeps its cards, wherever its caret was left.
    editor.caret("Example");
    expect(cards()).toHaveLength(1);
    editor.view.dom.dispatchEvent(new FocusEvent("focus"));
    expect(cards()).toHaveLength(0);
    editor.caret("After");
    expect(cards()).toHaveLength(1);
    editor.caret("Example");
    editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    expect(cards()).toHaveLength(1);
  });

  it("are not drawn inside a quote or for a link with other text around it", () => {
    editor.open("> [Quoted](https://example.com)\n\n**[Bold link](https://example.com)** plain\n");
    expect(cards()).toHaveLength(0);
  });
});
