import { describe, expect, it } from "vitest";

import type { BoardNode } from "../../../../lib/vault/types";
import { boardOutline } from "./outline-export";

const node = (patch: Partial<BoardNode> & { id: string }): BoardNode => ({ kind: "text", x: 0, y: 0, width: 100, height: 60, ...patch });
const link = (file: string, title: string | undefined) => `[[${file.replace(/\.md$/, "")}${title ? `|${title}` : ""}]]`;

describe("a board as an outline", () => {
  it("lists what is outside any section, then each section as a heading over its things", () => {
    const nodes = [
      node({ id: "loose", text: "Loose idea\nwith a second line", x: 900, y: 900 }),
      node({ id: "a", kind: "group", label: "Plan", x: 0, y: 0, width: 600, height: 400 }),
      node({ id: "c", kind: "file", file: "cards/one.md", title: "One", x: 20, y: 40, width: 200, height: 100 }),
      node({ id: "s", text: "  Then two  ", x: 300, y: 40, width: 200, height: 100 }),
      node({ id: "u", kind: "link", url: "https://example.com", x: 20, y: 200, width: 200, height: 100 }),
      node({ id: "b", kind: "group", label: "Later", x: 0, y: 500, width: 600, height: 300 }),
    ];
    expect(boardOutline("My board", nodes, link)).toBe(
      ["# My board", "", "- Loose idea", "", "## Plan", "", "- [[cards/one|One]]", "- Then two", "- [https://example.com](https://example.com)", "", "## Later", ""].join("\n").trimEnd() + "\n",
    );
  });

  it("puts a section inside another one level down, and names an unnamed one", () => {
    const nodes = [
      node({ id: "outer", kind: "group", label: "Talk", x: 0, y: 0, width: 800, height: 600 }),
      node({ id: "inner", kind: "group", label: "  ", x: 20, y: 40, width: 300, height: 300 }),
      node({ id: "t", text: "Opening", x: 40, y: 80, width: 100, height: 60 }),
    ];
    expect(boardOutline("Deck", nodes, link)).toBe("# Deck\n\n## Talk\n\n### Section\n\n- Opening\n");
  });

  it("leaves out drawings, pictures, missing notes and empty stickies", () => {
    const nodes = [
      node({ id: "d", text: "", draw: { points: "0,0 5,5", size: 4 } }),
      node({ id: "p", kind: "file", file: "pics/a.png", x: 10 }),
      node({ id: "m", kind: "file", file: "cards/gone.md", missing: true, x: 20 }),
      node({ id: "e", text: "   ", x: 30 }),
      node({ id: "k", kind: "file", file: "boards/inner.canvas", title: "Inner", x: 40 }),
    ];
    expect(boardOutline("Quiet", nodes, link)).toBe("# Quiet\n\n- [[boards/inner.canvas|Inner]]\n");
  });

  it("is only a title for an empty board", () => {
    expect(boardOutline("Empty", [], link)).toBe("# Empty\n");
  });
});
