import { describe, expect, it } from "vitest";

import { engineAdvice, fixAction, problemPassage } from "./fixable";
import type { Diagnostic } from "./types";

const d = (over: Partial<Diagnostic>): Diagnostic => ({ file: "main.tex", line: 3, severity: "error", message: "Undefined control sequence.", ...over });

describe("what Fix with AI is for", () => {
  it("is the errors first, then undefined references and citations, then overfull boxes", () => {
    const ref = d({ severity: "warning", message: "Reference `fig:a' on page 2 undefined" });
    const box = d({ severity: "info", message: "Overfull \\hbox (4.0pt too wide) in paragraph at lines 3--4" });
    expect(fixAction([ref, box, d({})])).toBe("fix-latex-errors");
    expect(fixAction([box, ref])).toBe("check-latex-refs");
    expect(fixAction([box])).toBe("fix-overfull-boxes");
    expect(fixAction([d({ severity: "warning", message: "Citation `smith' on page 1 undefined" })])).toBe("check-latex-refs");
    expect(fixAction([d({ severity: "warning", message: "There were undefined references." })])).toBe("check-latex-refs");
    expect(fixAction([d({ severity: "warning", message: "Label `x' multiply defined." })])).toBe("check-latex-refs");
  });

  it("is nothing for the rest", () => {
    expect(fixAction([])).toBeNull();
    expect(fixAction([d({ severity: "warning", message: "Font shape `OT1/cmr/m/n' undefined" }), d({ severity: "info", message: "Underfull \\hbox (badness 5000)" })])).toBeNull();
  });
});

describe("a problem in words", () => {
  it("names the place, the message and where TeX stopped", () => {
    expect(problemPassage(d({ file: "sections/a.tex", line: 12, context: "l.12 \\sectoin\n    {Intro}" }), "main.tex")).toBe("Error in sections/a.tex line 12: Undefined control sequence.\nTeX stopped at:\nl.12 \\sectoin\n    {Intro}");
    expect(problemPassage(d({ file: null, line: null, severity: "warning", message: "Careful" }), "main.tex")).toBe("Warning in main.tex: Careful");
  });
});

describe("the engine advice", () => {
  it("is for pdfLaTeX documents that need Unicode or fontspec, as the assistant is told", () => {
    const unicode = d({ message: "inputenc: Unicode character € (U+20AC) not set up for use with LaTeX." });
    expect(engineAdvice("latexmk-pdf", "", [unicode])).toContain("XeLaTeX");
    expect(engineAdvice("latexmk-pdf", "\\usepackage{fontspec}", [])).toContain("XeLaTeX");
    expect(engineAdvice("latexmk-pdf", "\\setmainfont{Libertinus Serif}", [])).not.toBeNull();
    expect(engineAdvice("latexmk-pdf", "% \\usepackage{fontspec}\n\\usepackage{fontspecial}", [])).toBeNull();
    for (const engine of ["tectonic", "latexmk-xe", "latexmk-lua"]) expect(engineAdvice(engine, "\\usepackage{fontspec}", [unicode])).toBeNull();
  });
});
