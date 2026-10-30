import { describe, expect, it } from "vitest";

import { codeThemeSpec } from "./codemirror-spec";

describe("code theme", () => {
  const spec = codeThemeSpec();
  const text = JSON.stringify(spec);

  it("is built from tokens only, so it follows data-theme", () => {
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(text).toContain("var(--color-ink)");
    expect(text).toContain("var(--color-canvas)");
  });

  it("styles the box, caret, selection and gutters", () => {
    for (const selector of ["&", ".cm-content", ".cm-cursor, .cm-dropCursor",".cm-gutters", ".cm-activeLine", ".cm-selectionBackground"]) {
      expect(Object.keys(spec)).toContain(selector);
    }
  });
});
