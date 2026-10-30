// Math and coloured code in an answer: read as the page editor reads math,
// drawn once KaTeX / the highlighter have loaded (both load only when needed).

import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { parseBlocks } from "./blocks";
import { highlight } from "./highlight-code";
import { parseInline, wordsOf } from "./inline";
import { Markdown } from "./Markdown";
import { plainText } from "./plain";

afterEach(cleanup);

const maths = (text: string) => parseInline(text).filter((n) => n.type === "math");

describe("math in text", () => {
  it("reads $…$ and $$…$$ written in a line", () => {
    expect(maths("Energy is $E=mc^2$, and $$a+b$$ too.")).toEqual([
      { type: "math", tex: "E=mc^2", display: false },
      { type: "math", tex: "a+b", display: true },
    ]);
    expect(wordsOf(parseInline("so $x^2$ holds"))).toBe("so x^2 holds");
  });

  it("leaves prices, escaped dollars and half-streamed math as text", () => {
    expect(maths("It costs $5 and then $10 more.")).toEqual([]);
    expect(maths("Between $5-$10.")).toEqual([]);
    expect(maths("Pay \\$5 or \\$6.")).toEqual([]);
    expect(maths("A $ b and c $ d")).toEqual([]);
    expect(maths("Unfinished $x^2 + ")).toEqual([]);
    expect(maths("Not across\nlines $a\nb$")).toEqual([]);
  });

  it("keeps math out of code spans", () => {
    expect(maths("Run `echo $HOME and $PATH` now.")).toEqual([]);
  });
});

describe("display math as a block", () => {
  it("reads $$ lines around TeX, and $$…$$ alone on a line", () => {
    expect(parseBlocks("Before\n\n$$\n\\int_0^1 x\\,dx\n= \\tfrac12\n$$\n\nAfter").map((b) => b.type)).toEqual(["paragraph", "math", "paragraph"]);
    expect(parseBlocks("$$\nx = 1\n$$")[0]).toMatchObject({ type: "math", text: "x = 1" });
    expect(parseBlocks("$$ y = 2 $$")[0]).toMatchObject({ type: "math", text: "y = 2" });
  });

  it("runs an unclosed one to the end while it streams, and takes its close when it comes", () => {
    expect(parseBlocks("$$\nx = 1")[0]).toMatchObject({ type: "math", text: "x = 1" });
    expect(parseBlocks("$$\nx = 1\n$$\nafter").map((b) => b.type)).toEqual(["math", "paragraph"]);
  });

  it("is a paragraph when the line goes on past the closing marks", () => {
    expect(parseBlocks("$$x$$ is the answer")[0]).toMatchObject({ type: "paragraph" });
  });
});

describe("copy as plain words", () => {
  it("takes the marks out", () => {
    const md = "# Title\n\nSome **bold** and `code` with [[Page]].\n\n- one\n- two\n\n1. first\n\n```ts\nconst a = 1;\n```\n\n$$\nx\n$$";
    expect(plainText(md)).toBe("Title\n\nSome bold and code with Page.\n\n- one\n- two\n\n1. first\n\nconst a = 1;\n\nx");
  });
});

describe("drawing", () => {
  it("shows the TeX at once and draws it with KaTeX once that has loaded", async () => {
    const { container } = render(<Markdown text={"Known: $E=mc^2$\n\n$$\\frac{a}{b}$$"} onOpenTitle={() => {}} />);
    expect(container.textContent).toContain("$E=mc^2$");
    await waitFor(() => expect(container.querySelectorAll(".katex").length).toBe(2));
    expect(container.querySelector(".katex-display")).toBeTruthy();
    expect(container.querySelector("p .katex")).toBeTruthy();
    // A formula that does not parse is shown, gently, not thrown.
    const bad = render(<Markdown text={"Broken $\\frac{a$ here"} onOpenTitle={() => {}} />);
    await waitFor(() => expect(bad.container.querySelector(".katex-error, .is-error")).toBeTruthy());
  });

  it("colours code in a known language, and leaves the rest plain", async () => {
    const { container } = render(<Markdown text={"```ts\nconst name = 'Ada'; // hi\n```\n\n```python\nprint('x')\n```"} onOpenTitle={() => {}} />);
    await waitFor(() => expect(container.querySelector(".cm-code-keyword")).toBeTruthy());
    const code = container.querySelectorAll("pre code");
    expect(code[0]!.textContent).toBe("const name = 'Ada'; // hi");
    expect(code[0]!.querySelector(".cm-code-string")?.textContent).toBe("'Ada'");
    expect(code[0]!.querySelector(".cm-code-comment")?.textContent).toBe("// hi");
    expect(code[1]!.querySelector("span")).toBeNull();
  });

  it("colours HTML and CSS, and keeps long code plain", () => {
    expect(highlight("html", '<p class="a">hi</p>')?.some((r) => r.cls === "cm-code-tag")).toBe(true);
    expect(highlight("css", "a { color: red; }")?.map((r) => r.text).join("")).toBe("a { color: red; }");
    expect(highlight("ts", "x".repeat(30_000))).toBeNull();
    expect(highlight("python", "print(1)")).toBeNull();
  });
});

describe("what is loaded up front", () => {
  it("brings in KaTeX and the highlighter only through dynamic imports, so the entry's budget holds", () => {
    const statics = (file: string) => readFileSync(`src/features/chat/markdown/${file}`, "utf8").split("\n").filter((l) => /^import\b(?!\s+type)/.test(l) && /katex|highlight-code|codemirror/.test(l));
    for (const file of ["Math.tsx", "CodeBlock.tsx", "Markdown.tsx"]) expect(statics(file)).toEqual([]);
  });
});
