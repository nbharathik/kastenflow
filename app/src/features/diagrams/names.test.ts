import { describe, expect, it } from "vitest";

import { isDiagramPath, isPicturePath, pathFor, pictureOf, sourceOf, stemOfPath, stemOfTitle, titleOfPath, validTitle } from "./names";

describe("diagram names", () => {
  it("make a file name from a title, keeping its case and the letters of any script", () => {
    for (const [title, stem] of [
      ["OAuth flow", "OAuth-flow"],
      ["  Plan: v2 / final?  ", "Plan-v2-final"],
      ["Café menu", "Café-menu"],
      ["日本語 図", "日本語-図"],
      ["???", "untitled"],
      ["con", "con-1"],
      ["a_b", "a-b"],
    ] as const) expect(stemOfTitle(title), title).toBe(stem);
    expect(stemOfTitle("a".repeat(200))).toHaveLength(80);
    expect(new TextEncoder().encode(stemOfTitle("語".repeat(100))).length).toBeLessThanOrEqual(120);
  });

  it("read a title from the file's name, dashes and underscores as spaces", () => {
    expect(titleOfPath("library/OAuth-flow.drawio")).toBe("OAuth flow");
    expect(titleOfPath("library/OAuth-flow.drawio.svg")).toBe("OAuth flow");
    expect(titleOfPath("projects/p/diagrams/Q3_map-2.drawio")).toBe("Q3 map 2");
    expect(stemOfPath("a/b/c.drawio")).toBe("c");
    expect(titleOfPath("a/---.drawio")).toBe("---.drawio");
  });

  it("find a diagram's two files from either", () => {
    expect(pictureOf("library/a.drawio")).toBe("library/a.drawio.svg");
    expect(sourceOf("library/a.drawio.svg")).toBe("library/a.drawio");
    expect(sourceOf("library/a.drawio")).toBe("library/a.drawio");
    expect(isDiagramPath("library/a.drawio")).toBe(true);
    expect(isDiagramPath("library/a.drawio.svg")).toBe(false);
    expect(isPicturePath("library/a.drawio.svg")).toBe(true);
    expect(isPicturePath("library/a.svg")).toBe(false);
    expect(pathFor("library", "Login flow")).toBe("library/Login-flow.drawio");
  });

  it("refuse the titles the core refuses", () => {
    for (const bad of ["", "  ", "A|B", "A[1]", "A\nB", "tab\there"]) expect(validTitle(bad), JSON.stringify(bad)).toBe(false);
    expect(validTitle("Login flow")).toBe(true);
  });
});
