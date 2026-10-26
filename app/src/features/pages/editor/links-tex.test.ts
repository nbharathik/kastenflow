import { describe, expect, it } from "vitest";
import { isFileTarget } from "./links";

describe("links to LaTeX files", () => {
  it("treats source files as files, so a missing one never offers to make a page", () => {
    expect(isFileTarget("main.tex")).toBe(true);
    expect(isFileTarget("papers/thesis/Main.TEX")).toBe(true);
    expect(isFileTarget("style.sty")).toBe(true);
    expect(isFileTarget("article.cls")).toBe(true);
    expect(isFileTarget("plain.bst")).toBe(true);
  });

  it("keeps titles that only look like an extension as titles", () => {
    expect(isFileTarget("Notes on LaTeX")).toBe(false);
    expect(isFileTarget("Version 2.0")).toBe(false);
  });
});
