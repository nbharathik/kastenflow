import { describe, expect, it } from "vitest";

import { scanLabels, scanOutline, stripComment } from "./scan";

describe("labels in a document", () => {
  it("finds each label with its file, line and what is on the line", () => {
    const text = ["\\section{Intro}\\label{sec:intro}", "Text", "\\begin{equation}\\label{eq:one} a=b \\end{equation}", "\\label{a}\\label{b}"].join("\n");
    const labels = scanLabels(text, "sections/intro.tex");
    expect(labels.map((l) => [l.key, l.line])).toEqual([
      ["sec:intro", 1],
      ["eq:one", 3],
      ["a", 4],
      ["b", 4],
    ]);
    expect(labels[0]!.file).toBe("sections/intro.tex");
    expect(labels[0]!.context).toBe("\\section{Intro}");
  });

  it("ignores labels in comments but not an escaped percent sign", () => {
    const text = "% \\label{old}\n50\\% done \\label{kept}\nx % \\label{gone}";
    expect(scanLabels(text, "a.tex").map((l) => l.key)).toEqual(["kept"]);
    expect(stripComment("a \\% b % c")).toBe("a \\% b ");
  });
});

describe("the outline of a document", () => {
  it("reads nested sections, starred ones and optional short titles", () => {
    const text = [
      "\\documentclass{article}",
      "\\part{One}",
      "\\section{Intro}",
      "\\subsection*{Why \\emph{now}}",
      "  \\subsubsection[short]{Deep}",
      "\\paragraph{Para}",
      "\\subparagraph{Sub}",
      "\\section*{Thanks}",
    ].join("\n");
    const items = scanOutline(text);
    expect(items.map((i) => [i.command, i.level, i.title, i.starred, i.line])).toEqual([
      ["part", 0, "One", false, 2],
      ["section", 2, "Intro", false, 3],
      ["subsection", 3, "Why now", true, 4],
      ["subsubsection", 4, "Deep", false, 5],
      ["paragraph", 5, "Para", false, 6],
      ["subparagraph", 6, "Sub", false, 7],
      ["section", 2, "Thanks", true, 8],
    ]);
  });

  it("skips commented headings and commands that only start like one", () => {
    const text = "% \\section{Old}\n\\sectionmark{x}\n\\sectionfont{y}\nSee \\section{inline} here\n\\section{Real}";
    expect(scanOutline(text).map((i) => i.title)).toEqual(["Real"]);
  });

  it("finds a title with braces inside and one that runs past the line", () => {
    expect(scanOutline("\\section{A {B} C}")[0]!.title).toBe("A B C");
    expect(scanOutline("\\section{Open")[0]!.title).toBe("Open");
    expect(scanOutline("\\section{}")[0]!.title).toBe("(section)");
  });

  it("is quick on a 30-page source", () => {
    const body = Array.from({ length: 2400 }, (_, i) => (i % 40 === 0 ? `\\section{S${i}}\\label{s${i}}` : "Lorem ipsum \\emph{dolor} sit amet, $a_1+b^2$.")).join("\n");
    const start = performance.now();
    const items = scanOutline(body);
    const labels = scanLabels(body, "main.tex");
    const took = performance.now() - start;
    expect(items).toHaveLength(60);
    expect(labels).toHaveLength(60);
    // Indicative only: the scan runs after typing stops, never inside a keystroke.
    expect(took).toBeLessThan(100);
  });
});
