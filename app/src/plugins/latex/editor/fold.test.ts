import { foldable } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { foldByHeading, foldUnder, headingLevel } from "./fold";

const SOURCE = [
  "\\documentclass{article}", // 1
  "\\begin{document}", // 2
  "\\section{Intro}", // 3
  "Hello.", // 4
  "", // 5
  "\\subsection{Why}", // 6
  "Because.", // 7
  "", // 8
  "\\section{Method}", // 9
  "We did it.", // 10
  "\\end{document}", // 11
].join("\n");

describe("folding by heading", () => {
  const doc = Text.of(SOURCE.split("\n"));

  it("knows the level of a heading and ignores the rest", () => {
    expect(headingLevel("\\section{A}")).toBe(2);
    expect(headingLevel("  \\subsection*{A}")).toBe(3);
    expect(headingLevel("\\chapter[short]{A}")).toBe(1);
    expect(headingLevel("% \\section{commented}")).toBeNull();
    expect(headingLevel("\\sectionmark{x}")).toBeNull();
    expect(headingLevel("text \\section{x}")).toBeNull();
  });

  it("a section folds up to the next section, without the blank line before it", () => {
    const range = foldUnder(doc, 3)!;
    expect(doc.sliceString(range.from, range.to)).toBe("\nHello.\n\n\\subsection{Why}\nBecause.");
  });

  it("a subsection stops at the next heading of a higher level", () => {
    const range = foldUnder(doc, 6)!;
    expect(doc.sliceString(range.from, range.to)).toBe("\nBecause.");
  });

  it("the last section stops before \\end{document}", () => {
    const range = foldUnder(doc, 9)!;
    expect(doc.sliceString(range.from, range.to)).toBe("\nWe did it.");
  });

  it("a heading with nothing under it, and a plain line, fold nowhere", () => {
    const empty = Text.of(["\\section{A}", "\\section{B}", "text"]);
    expect(foldUnder(empty, 1)).toBeNull();
    expect(foldUnder(doc, 4)).toBeNull();
  });

  it("is a fold service the editor's state answers to", () => {
    const state = EditorState.create({ doc: SOURCE, extensions: [foldByHeading] });
    const line = state.doc.line(3);
    expect(foldable(state, line.from, line.to)).toEqual(foldUnder(state.doc, 3));
    const plain = state.doc.line(4);
    expect(foldable(state, plain.from, plain.to)).toBeNull();
  });
});
