// Finding a heading by its text for a `kasten:` link: the nth heading of that
// text, ignoring case, and the number a heading has among those of its text.

import type { Crepe } from "@milkdown/crepe";
import { TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import { findText, useTestEditor } from "../../../test/editor";
import { handleFor, headingAt, headingNumber } from "./page-handle";

const editor = useTestEditor();

/** Where each heading of the open page starts, top to bottom. */
function headings(): number[] {
  const at: number[] = [];
  editor.view.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading") at.push(offset);
  });
  return at;
}

describe("headings found by their text", () => {
  it("finds the first heading of a text, ignoring case and spaces, or the nth", () => {
    editor.open("## Plan\n\nText\n\n### plan \n\nMore\n\n## Costs\n");
    const [first, second, costs] = headings();
    expect(headingAt(editor.view.state.doc, "Plan")).toBe(first);
    expect(headingAt(editor.view.state.doc, "  PLAN ", 1)).toBe(first);
    expect(headingAt(editor.view.state.doc, "plan", 2)).toBe(second);
    expect(headingAt(editor.view.state.doc, "Costs")).toBe(costs);
    expect(headingAt(editor.view.state.doc, "plan", 3)).toBeNull();
    expect(headingAt(editor.view.state.doc, "Nothing here")).toBeNull();
  });

  it("numbers a heading among the headings of its text, from the top", () => {
    editor.open("## Plan\n\nText\n\n## Plan\n\n## Other\n\n## Plan\n");
    const [one, two, other, three] = headings();
    expect(headingNumber(editor.view.state.doc, one!)).toBe(1);
    expect(headingNumber(editor.view.state.doc, two!)).toBe(2);
    expect(headingNumber(editor.view.state.doc, other!)).toBe(1);
    expect(headingNumber(editor.view.state.doc, three!)).toBe(3);
  });

  it("does not look for a heading inside a paragraph that reads the same", () => {
    editor.open("Plan\n\n## Plan\n");
    expect(headingAt(editor.view.state.doc, "Plan")).toBe(headings()[0]);
  });
});

describe("the handle's part for comments and highlights", () => {
  const PAGE = "Intro words here.\n\n---\n\n## Plan\n\nBook the guesthouse today.\n";
  const handle = () => handleFor({ editor: { ctx: editor.ctx } } as unknown as Crepe, () => {}, () => {});
  const select = (words: string) => {
    const at = findText(editor.doc, words);
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, at, at + words.length)));
  };

  it("gives the page's words as text cut into its sections", () => {
    editor.open(PAGE);
    const text = handle().annotationText();
    expect(text.sections.map((s) => [s.title, s.text])).toEqual([
      ["Intro words here.", "Intro words here."],
      ["Plan", "Plan\nBook the guesthouse today."],
    ]);
  });

  it("gives the words selected with what stands around them, and nothing for a caret", () => {
    editor.open(PAGE);
    editor.caret("guesthouse");
    expect(handle().selectedWords(400)).toBeNull();
    select("guesthouse");
    const picked = handle().selectedWords(400)!;
    expect(picked.words).toMatchObject({ quote: "guesthouse", suffix: " today." });
    expect(picked.words.prefix.endsWith("Plan\nBook the ")).toBe(true);
    expect(picked.text.full.slice(picked.words.from, picked.words.to)).toBe("guesthouse");
    expect(handle().selectedWords(4)!.words.quote).toBe("gues");
  });

  it("knows the section the caret is in", () => {
    editor.open(PAGE);
    editor.caret("Intro");
    expect(handle().caretSection()).toBe(0);
    editor.caret("guesthouse");
    expect(handle().caretSection()).toBe(1);
  });

  it("selects words it is shown, found again when the range it was given is stale", () => {
    editor.open(PAGE);
    const text = handle().annotationText();
    const from = text.full.indexOf("guesthouse");
    expect(handle().showWords({ from, to: from + "guesthouse".length }, "guesthouse")).toBe(true);
    const { selection, doc } = editor.view.state;
    expect(doc.textBetween(selection.from, selection.to)).toBe("guesthouse");
    // A range that no longer holds the words: they are found where they are.
    editor.caret("Intro");
    expect(handle().showWords({ from: 0, to: 5 }, "guesthouse")).toBe(true);
    expect(editor.doc.textBetween(editor.view.state.selection.from, editor.view.state.selection.to)).toBe("guesthouse");
    expect(handle().showWords({ from: 0, to: 5 }, "words that are not there")).toBe(false);
  });

  it("paints highlights over the words", () => {
    editor.open(PAGE);
    handle().paint([{ id: "a", color: "pink", anchor: { quote: "guesthouse" } }]);
    expect(editor.view.dom.querySelector(".kasten-text-hl.is-pink")?.textContent).toBe("guesthouse");
    handle().paint([]);
    expect(editor.view.dom.querySelector(".kasten-text-hl")).toBeNull();
  });
});
