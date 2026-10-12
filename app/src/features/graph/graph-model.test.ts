import { describe, expect, it } from "vitest";

import type { GraphNode, VaultGraph } from "../../lib/vault/types";
import { SHOW_ALL, colourOf, findNodes, hasFilters, indexOfId, kindCounts, labelThreshold, modelOf, neighbourToward, neighbourhood, radiusOf, scopeKey } from "./graph-model";

const node = (id: string, kind = "page", over: Partial<GraphNode> = {}): GraphNode => ({ id, path: kind === "ghost" ? null : id, title: id.replace(/^.*\//, "").replace(/\.md$/, ""), kind, project: null, links: 0, ...over });

/** a - b - c, d - ghost, e on its own, a board holding b. */
const graph: VaultGraph = {
  nodes: [node("a.md", "page", { links: 1 }), node("b.md", "page", { links: 3 }), node("c.md", "card", { links: 1 }), node("d.md", "page", { links: 1 }), node("e.md", "page"), node("ghost:gap", "ghost", { links: 1 }), node("m.canvas", "board", { links: 1 })],
  edges: [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 1, embed: true },
    { from: 3, to: 5 },
    { from: 6, to: 1, board: true },
  ],
};

const ids = (g: { nodes: GraphNode[] }) => g.nodes.map((n) => n.id);

describe("the graph's model", () => {
  it("keeps everything with no filters, and links each pair once as neighbours", () => {
    const model = modelOf(graph, SHOW_ALL);
    expect(ids(model)).toEqual(ids(graph));
    expect(model.edges).toHaveLength(5);
    expect(model.neighbours[1]!.sort()).toEqual([0, 2, 6]);
    expect(model.neighbours[2]).toEqual([1]);
    expect(model.neighbours[4]).toEqual([]);
    expect(model.origin).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("hides orphans, ghosts and kinds, and the edges that went with them", () => {
    expect(ids(modelOf(graph, { ...SHOW_ALL, orphans: false }))).not.toContain("e.md");
    const noGhosts = modelOf(graph, { ...SHOW_ALL, ghosts: false });
    expect(ids(noGhosts)).not.toContain("ghost:gap");
    expect(noGhosts.edges).toHaveLength(4);
    // d lost its only neighbour but stays: it had a link.
    expect(ids(noGhosts)).toContain("d.md");
    const noCards = modelOf(graph, { ...SHOW_ALL, hiddenKinds: ["card", "board"] });
    expect(ids(noCards)).toEqual(["a.md", "b.md", "d.md", "e.md", "ghost:gap"]);
    // Edges follow the new places: a - b is still 0 - 1.
    expect(noCards.edges).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 4 },
    ]);
    expect(noCards.origin).toEqual([0, 1, 3, 4, 5]);
  });

  it("keeps the pages that carry every tag asked for", () => {
    const tags: Record<string, string[]> = { "a.md": ["Paper", "idea"], "b.md": ["paper"], "c.md": ["idea"] };
    const model = modelOf(graph, { ...SHOW_ALL, tags: ["paper"] }, (path) => tags[path] ?? []);
    expect(ids(model)).toEqual(["a.md", "b.md"]);
    expect(ids(modelOf(graph, { ...SHOW_ALL, tags: ["paper", "idea"] }, (path) => tags[path] ?? []))).toEqual(["a.md"]);
  });

  it("tells whether any filter is set", () => {
    expect(hasFilters(SHOW_ALL)).toBe(false);
    for (const set of [{ orphans: false }, { ghosts: false }, { hiddenKinds: ["card"] }, { tags: ["x"] }]) expect(hasFilters({ ...SHOW_ALL, ...set })).toBe(true);
  });

  it("takes in a node and its neighbours for the highlight", () => {
    const model = modelOf(graph, SHOW_ALL);
    expect([...neighbourhood(model, 1)].sort()).toEqual([0, 1, 2, 6]);
    expect([...neighbourhood(model, 4)]).toEqual([4]);
  });
});

describe("how a node looks", () => {
  it("grows with its links up to a limit", () => {
    expect(radiusOf(0)).toBeLessThan(radiusOf(1));
    expect(radiusOf(4)).toBeLessThan(radiusOf(40));
    expect(radiusOf(100000)).toBe(14);
  });

  it("is coloured by kind, or by project with one colour for each", () => {
    expect(colourOf(node("a"), "kind")).toBe("blue");
    expect(colourOf(node("c", "card"), "kind")).toBe("yellow");
    expect(colourOf(node("m", "board"), "kind")).toBe("brown");
    expect(colourOf(node("g", "ghost"), "kind")).toBe("gray");
    expect(colourOf(node("x", "weird"), "kind")).toBe("gray");
    const one = colourOf(node("a", "page", { project: "trip" }), "project");
    expect(colourOf(node("b", "card", { project: "trip" }), "project")).toBe(one);
    expect(colourOf(node("c", "page", { project: null }), "project")).toBe("gray");
    expect(colourOf(node("g", "ghost", { project: "trip" }), "project")).toBe("gray");
  });

  it("names more nodes the closer the zoom", () => {
    const at = (zoom: number) => labelThreshold(zoom, 100);
    expect(at(0.2)).toBe(Infinity);
    expect(at(0.5)).toBeGreaterThan(at(0.8));
    expect(at(0.8)).toBeGreaterThan(at(1.2));
    expect(at(3)).toBe(0);
    // A busy graph names fewer at the same zoom.
    expect(labelThreshold(1.2, 5000)).toBeGreaterThan(labelThreshold(1.2, 50));
  });
});

describe("finding nodes", () => {
  const model = modelOf(
    {
      nodes: [node("1", "page", { title: "Reading list", links: 2 }), node("2", "page", { title: "List of books", links: 1 }), node("3", "page", { title: "Playlist", links: 9 }), node("4", "page", { title: "Other" })],
      edges: [],
    },
    SHOW_ALL,
  );

  it("puts titles that start with it first, then words, then the rest", () => {
    expect(findNodes(model, "list").map((i) => model.nodes[i]!.title)).toEqual(["List of books", "Reading list", "Playlist"]);
    expect(findNodes(model, "  ")).toEqual([]);
    expect(findNodes(model, "zzz")).toEqual([]);
    expect(findNodes(model, "list", 1)).toHaveLength(1);
    expect(indexOfId(model, "3")).toBe(2);
    expect(indexOfId(model, "nope")).toBe(-1);
  });
});

describe("kinds, scopes and arrow keys", () => {
  it("counts the kinds with the most first", () => {
    const kinds = kindCounts(graph);
    expect(kinds[0]).toEqual({ kind: "page", label: "Pages", count: 4 });
    // Ties go by label: Cards, Missing pages, Whiteboards.
    expect(kinds.map((k) => k.kind)).toEqual(["page", "card", "ghost", "board"]);
    expect(kinds.find((k) => k.kind === "ghost")!.label).toBe("Missing pages");
  });

  it("keys a scope by what it shows", () => {
    expect(scopeKey({ kind: "vault" })).toBe("vault");
    expect(scopeKey({ kind: "project", path: "projects/x/_project.md" })).toBe("project:projects/x/_project.md");
    expect(scopeKey({ kind: "around", path: "a.md", depth: 2 })).toBe("around:a.md:2");
  });

  it("moves to the linked node that lies that way", () => {
    const model = modelOf(graph, SHOW_ALL);
    // b at the origin, a to its left, c above it, the board to its right.
    const places = Float64Array.from([-10, 0, 0, 0, 0, -10, 0, 20, 5, 30, 0, 40, 10, 0]);
    expect(neighbourToward(model, places, 1, -1, 0)).toBe(0);
    expect(neighbourToward(model, places, 1, 0, -1)).toBe(2);
    expect(neighbourToward(model, places, 1, 1, 0)).toBe(6);
    expect(neighbourToward(model, places, 1, 0, 1)).toBe(-1);
  });
});
