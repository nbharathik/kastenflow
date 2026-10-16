// The page's words as the anchors read them: sections as the strip names
// them, a line break between blocks, and a way from a stretch of the text to
// the document positions it covers and back.

import { describe, expect, it } from "vitest";

import { useTestEditor } from "../../test/editor";
import { editorText, offsetsOf, positionsOf } from "./doc-text";

const editor = useTestEditor();

const PAGE = ["Intro words here.", "", "---", "", "## Plan", "", "Book the guesthouse.", "", "- a list", "- of items", "", "---", "", "Last bit.", ""].join("\n");

describe("the page as text", () => {
  it("is cut at the dividers, each section named as the section strip names it", () => {
    editor.open(PAGE);
    const text = editorText(editor.doc);
    expect(text.sections.map((s) => s.title)).toEqual(["Intro words here.", "Plan", "Last bit."]);
    expect(text.sections.map((s) => s.text)).toEqual(["Intro words here.", "Plan\nBook the guesthouse.\na list\nof items", "Last bit."]);
    expect(text.full).toBe(text.sections.map((s) => s.text).join("\n"));
    expect(text.pos).toHaveLength(text.full.length);
    expect(text.starts).toEqual([0, "Intro words here.".length + 1, "Intro words here.\nPlan\nBook the guesthouse.\na list\nof items".length + 1]);
  });

  it("is one section for a page without dividers", () => {
    editor.open("# Title\n\nSome words.\n");
    const text = editorText(editor.doc);
    expect(text.sections).toHaveLength(1);
    expect(text.full).toBe("Title\nSome words.");
  });

  it("reads a link as the words it shows", () => {
    editor.open("See [[Trip plan|the plan]] and [[Packing]] today.\n");
    expect(editorText(editor.doc).full).toBe("See the plan and Packing today.");
  });

  it("is empty for an empty page", () => {
    editor.open("");
    const text = editorText(editor.doc);
    expect(text.full).toBe("");
    expect(positionsOf(text, { from: 0, to: 0 })).toBeNull();
  });
});

describe("from text to the document and back", () => {
  it("finds the positions of a stretch of words, across blocks too", () => {
    editor.open(PAGE);
    const text = editorText(editor.doc);
    for (const words of ["guesthouse", "Plan\nBook the", "of items", "Last bit."]) {
      const from = text.full.indexOf(words);
      const at = positionsOf(text, { from, to: from + words.length });
      expect(at, words).not.toBeNull();
      expect(editor.doc.textBetween(at!.from, at!.to, "\n"), words).toBe(words);
      expect(offsetsOf(text, at!.from, at!.to)).toEqual({ from, to: from + words.length });
    }
  });

  it("maps the document's own selection to the text it covers", () => {
    editor.open(PAGE);
    const text = editorText(editor.doc);
    const start = editor.doc.textContent.indexOf("guesthouse");
    expect(start).toBeGreaterThan(0);
    editor.caret("guesthouse");
    const { from } = editor.view.state.selection;
    const covered = offsetsOf(text, from, from + "guesthouse".length);
    expect(text.full.slice(covered.from, covered.to)).toBe("guesthouse");
  });

  it("refuses a stretch outside the text", () => {
    editor.open(PAGE);
    const text = editorText(editor.doc);
    expect(positionsOf(text, { from: 3, to: 3 })).toBeNull();
    expect(positionsOf(text, { from: 0, to: text.full.length + 1 })).toBeNull();
    expect(positionsOf(text, { from: -1, to: 2 })).toBeNull();
  });
});
