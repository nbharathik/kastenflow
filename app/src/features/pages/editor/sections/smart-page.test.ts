// "/smart page" in the slash menu: two sections to start and the layout on.

import { Selection } from "@milkdown/kit/prose/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import { choiceCommand } from "../menus/slash";
import { matchChoices, SLASH_CHOICES } from "../menus/catalog";
import { isSmart, setSmart } from "./api";

const kept = vi.fn();
const editor = useTestEditor({ foldKey: "note-1", onSmartPage: () => kept() });

// "Smart page" is the name of a page with a view of its own; this one cuts a page into sections.
const smartPage = () => matchChoices(SLASH_CHOICES, "sections")[0]!;
const run = () => editor.run(choiceCommand(smartPage(), editor.ctx));

beforeEach(() => {
  kept.mockClear();
  localStorage.clear();
});
afterEach(() => {
  setSmart(editor.view, false);
  localStorage.clear();
});

describe("/smart page", () => {
  it("is in the slash menu, found by what it is", () => {
    expect(smartPage().key).toBe("smart-page");
    expect(smartPage().label).toBe("Sections layout");
    expect(SLASH_CHOICES.some((c) => c.label === "Smart page")).toBe(false);
    for (const word of ["sections", "slides", "present", "cards"]) expect(matchChoices(SLASH_CHOICES, word).map((c) => c.key), word).toContain("smart-page");
    // It does not take the page block's place when asked for a page.
    expect(matchChoices(SLASH_CHOICES, "page")[0]!.key).toBe("page");
  });

  it("makes two sections on an empty page, with the caret in the first, and turns the layout on", () => {
    editor.open("");
    editor.view.dispatch(editor.view.state.tr.setSelection(Selection.atStart(editor.doc)));
    expect(isSmart(editor.view.state)).toBe(false);
    expect(run()).toBe(true);
    expect(editor.types()).toEqual(["paragraph", "hr", "paragraph"]);
    expect(editor.view.state.selection.$from.index(0)).toBe(0);
    expect(isSmart(editor.view.state)).toBe(true);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(editor.view.dom.querySelectorAll(".kasten-sec-head")).toHaveLength(2);
    // Empty paragraphs are not written: the page's text is one divider.
    expect(editor.save()).toBe("---\n");
  });

  it("starts a second section after the text that is there, when the page has none", () => {
    editor.open("Some words.\n");
    editor.caret("Some words.", true);
    expect(run()).toBe(true);
    expect(editor.types()).toEqual(["paragraph", "hr", "paragraph"]);
    // Writing goes on in the new section.
    expect(editor.view.state.selection.$from.index(0)).toBe(2);
    expect(editor.save()).toBe("Some words.\n\n---\n");
  });

  it("adds one more section to a page that has them, in the empty block it was typed in", () => {
    editor.open("One.\n\n---\n\nTwo.\n\nx\n");
    editor.caret("x", false);
    editor.view.dispatch(editor.view.state.tr.delete(editor.view.state.selection.from, editor.view.state.selection.from + 1));
    expect(run()).toBe(true);
    expect(editor.types().filter((t) => t === "hr")).toHaveLength(2);
    expect(editor.types().at(-2)).toBe("hr");
    expect(editor.types().at(-1)).toBe("paragraph");
    expect(editor.view.state.selection.$from.index(0)).toBe(editor.doc.childCount - 1);
  });
});
