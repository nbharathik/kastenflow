import { describe, expect, it } from "vitest";

import { outlineTree, readOutline, type OutlineNode } from "./outline";

const TRIP = `A week by the sea.

## Where to stay
- The old town, near the castle
- Baixa
  - close to the trams

## What to eat
1. **Pastéis** de nata
2. Bacalhau, see [[Recipes|the recipe]]

Some notes that are not part of the map.

### Before we go
- [ ] Flights
- [x] Insurance

\`\`\`
- not a list, code
\`\`\`
`;

const flat = (nodes: OutlineNode[], depth = 0): string[] => nodes.flatMap((n) => [`${"  ".repeat(depth)}${n.text}`, ...flat(n.children, depth + 1)]);
const keys = (nodes: OutlineNode[]): string[] => nodes.flatMap((n) => [n.key, ...keys(n.children)]);

describe("a page's outline as a tree", () => {
  it("takes headings and list items, nested as written, in plain words", () => {
    expect(flat(outlineTree(TRIP))).toEqual([
      "Where to stay",
      "  The old town, near the castle",
      "  Baixa",
      "    close to the trams",
      "What to eat",
      "  Pastéis de nata",
      "  Bacalhau, see the recipe",
      "  Before we go",
      "    ☐ Flights",
      "    ☑ Insurance",
    ]);
  });

  it("keeps big pages to a size a board can show, and says it cut", () => {
    const long = Array.from({ length: 200 }, (_, i) => `- item ${i}`).join("\n");
    expect(outlineTree(long, 50)).toHaveLength(50);
    expect(readOutline(long, 50).cut).toBe(true);
    expect(readOutline(long, 200).cut).toBe(false);
    expect(outlineTree("Just a paragraph.\n")).toEqual([]);
  });
});

describe("the keys that name a line", () => {
  it("are the line's words, lower case, without a to-do's box", () => {
    expect(keys(outlineTree(TRIP))).toEqual(["where to stay", "the old town, near the castle", "baixa", "close to the trams", "what to eat", "pastéis de nata", "bacalhau, see the recipe", "before we go", "flights", "insurance"]);
    // Ticking a box does not make a new line.
    const ticked = TRIP.replace("- [ ] Flights", "- [x] Flights");
    expect(keys(outlineTree(ticked))).toEqual(keys(outlineTree(TRIP)));
  });

  it("number the same words again under the same parent only", () => {
    const page = "## Notes\n- idea\n- idea\n- Idea\n## More\n- idea\n";
    expect(keys(outlineTree(page))).toEqual(["notes", "idea", "idea#2", "idea#3", "more", "idea"]);
  });

  it("stay the same when other lines of the page change", () => {
    const before = outlineTree(TRIP);
    const after = outlineTree(TRIP.replace("- Baixa", "- Baixa district").replace("## What to eat", "## What to eat\n- Ginjinha"));
    const all = (nodes: OutlineNode[]): OutlineNode[] => nodes.flatMap((n) => [n, ...all(n.children)]);
    const find = (nodes: OutlineNode[], key: string): OutlineNode | undefined => all(nodes).find((n) => n.key === key);
    expect(find(after, "where to stay")?.key).toBe(find(before, "where to stay")?.key);
    expect(find(after, "the old town, near the castle")?.key).toBe("the old town, near the castle");
    expect(find(after, "flights")?.key).toBe("flights");
    // The line that was edited has a new key, the rest are as they were.
    expect(find(after, "baixa")).toBeUndefined();
    expect(find(after, "baixa district")).toBeDefined();
  });
});
