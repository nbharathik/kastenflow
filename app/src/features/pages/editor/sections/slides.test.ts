// The slides of a page: its sections, else its H1 or H2 headings, else the whole
// page; and which of them are shown.

import { describe, expect, it } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import { slideAt, slidesOf } from "./slides";

const editor = useTestEditor({ foldKey: "note-1" });
const titles = (body: string) => {
  editor.open(body);
  return slidesOf(editor.doc).map((slide) => slide.title);
};

const FIVE = [
  "# Welcome",
  "",
  "Intro line.",
  "",
  "---",
  "",
  "## Problem",
  "",
  "- slow",
  "- noisy",
  "",
  "---",
  "",
  "## Plan",
  "",
  "Book the guesthouse.",
  "",
  "---",
  "",
  "## Budget",
  "",
  "A table is coming.",
  "",
  "---",
  "",
  "## Thanks",
  "",
  "Questions?",
  "",
].join("\n");

describe("the slides of a page", () => {
  it("are its sections when it has dividers", () => {
    expect(titles(FIVE)).toEqual(["Welcome", "Problem", "Plan", "Budget", "Thanks"]);
    const slides = slidesOf(editor.doc);
    expect(slides.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    // A slide starts at its divider, and its blocks follow it.
    expect(slides[0]!.start).toBe(0);
    expect(slides[1]!.start).toBe(slides[1]!.from - 1);
    expect(slides[1]!.blocks).toBe(2);
  });

  it("leave out sections with nothing in them, and the empty paragraph kept at the end", () => {
    expect(titles("One.\n\n---\n\n---\n\nThree.\n\n---\n")).toEqual(["One.", "Three."]);
    editor.open("One.\n\n---\n\nTwo.\n");
    // The page's click-below paragraph, after a trailing divider, is not a slide.
    editor.view.dispatch(editor.view.state.tr.insert(editor.doc.content.size, editor.view.state.schema.nodes.hr!.create()).insert(editor.doc.content.size + 1, editor.view.state.schema.nodes.paragraph!.create()));
    expect(slidesOf(editor.doc).map((s) => s.title)).toEqual(["One.", "Two."]);
    expect(titles("")).toEqual([]);
  });

  it("are cut at the H1 headings when there is no divider, the words before the first being a slide", () => {
    expect(titles("Words before.\n\n# One\n\ntext\n\n## sub\n\nmore\n\n# Two\n\nlast\n")).toEqual(["Words before.", "One", "Two"]);
    expect(titles("# A\n\none\n\n# B\n\ntwo\n")).toEqual(["A", "B"]);
  });

  it("are cut at the H2 headings when there is no H1, and when a lone H1 stands for the page", () => {
    expect(titles("Intro.\n\n## First\n\nx\n\n## Second\n\ny\n\n### deeper\n\nz\n")).toEqual(["Intro.", "First", "Second"]);
    // The page's own title leads the first slide instead of being the only one.
    expect(titles("# The talk\n\nOpening.\n\n## One\n\nx\n\n## Two\n\ny\n")).toEqual(["The talk", "One", "Two"]);
    // A lone H1 further down cuts the page, as there is nothing above it to be a title.
    expect(titles("Words.\n\n# Only\n\nafter\n")).toEqual(["Words.", "Only"]);
  });

  it("are the whole page when it has no divider and no H1 or H2", () => {
    expect(titles("Just words.\n\n- and a list\n\n### a small heading\n")).toEqual(["a small heading"]);
    expect(slidesOf(editor.doc)).toHaveLength(1);
    expect(titles("# Only a title\n\nand words\n")).toEqual(["Only a title"]);
  });

  it("know which slide a position is in, else the next one", () => {
    editor.open("One.\n\n---\n\n---\n\nThree.\n");
    const slides = slidesOf(editor.doc);
    expect(slides).toHaveLength(2);
    expect(slideAt(slides, 1)?.title).toBe("One.");
    // A position in the empty section between goes on to the next slide.
    expect(slideAt(slides, slides[0]!.to + 1)?.title).toBe("Three.");
    expect(slideAt(slides, editor.doc.content.size)?.title).toBe("Three.");
    expect(slideAt([], 3)).toBeNull();
  });
});
