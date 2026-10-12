import { describe, expect, it } from "vitest";

import { isPageLink, makePageLink, parsePageLink } from "./links.ts";

describe("links to pages of the host", () => {
  it("are page: and the path, with the marks of a link written out", () => {
    expect(makePageLink("library/plan.md")).toBe("page:library/plan.md");
    expect(makePageLink("library/my page (v2).md")).toBe("page:library/my%20page%20%28v2%29.md");
    expect(makePageLink("library/plan.md", "Risks and more")).toBe("page:library/plan.md#Risks%20and%20more");
    expect(makePageLink("a#b.md", "C#")).toBe("page:a%23b.md#C%23");
    expect(makePageLink("a.md", "   ")).toBe("page:a.md");
  });

  it("are read back to the page and the heading", () => {
    expect(parsePageLink("page:library/plan.md")).toEqual({ path: "library/plan.md", section: null });
    expect(parsePageLink("page:library/my%20page%20%28v2%29.md#Risks%20and%20more")).toEqual({ path: "library/my page (v2).md", section: "Risks and more" });
    expect(parsePageLink("PAGE:a.md#")).toEqual({ path: "a.md", section: null });
    for (const path of ["library/a b.md", "x#y/z (1).md", "100% done.md", "ünïcode/página.md"]) {
      for (const section of [null, "Part #2 (draft)", "100%"]) expect(parsePageLink(makePageLink(path, section))).toEqual({ path, section });
    }
  });

  it("are told from every other address, and a page-less one is no link", () => {
    expect(isPageLink("page:a.md")).toBe(true);
    expect(isPageLink("https://example.com/page:x")).toBe(false);
    expect(isPageLink("slide:s-1")).toBe(false);
    expect(isPageLink(undefined)).toBe(false);
    expect(parsePageLink("page:")).toBeNull();
    expect(parsePageLink("page:#Heading")).toBeNull();
    expect(parsePageLink("https://example.com")).toBeNull();
  });

  it("do not stop at a bad percent sign", () => {
    expect(parsePageLink("page:100%.md")).toEqual({ path: "100%.md", section: null });
  });
});
