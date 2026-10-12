import { describe, expect, it } from "vitest";

import type { VaultGraph } from "../../../lib/vault/types";
import { MemoryVault } from "./memory-vault";

const note = (title: string, body = "") => `---\ntitle: "${title}"\n---\n${body}\n`;
const deck = JSON.stringify({ format: "kasten-deck", formatVersion: 1, title: "Talk", slides: [] });
const board = (...files: string[]) => JSON.stringify({ nodes: files.map((file, i) => ({ id: `n${i}`, type: "file", file, x: 0, y: 0, width: 320, height: 180 })), edges: [] });

const SEED = {
  "library/alpha.md": note("Alpha", "See [[Beta#Intro|the intro]] and [[Beta]] and ![[Beta]].\nA gap: [[Not written yet]] and [[Not written yet]].\nDay [[2026-09-23]], none [[2031-01-01]].\nShared [[Plan]]. Board [[projects/trip/boards/map.canvas]] deck ![[library/talk.deck]] picture ![[assets/x.png]].\nSelf [[Alpha]]. `[[in code]]`\n"),
  "library/beta.md": note("Beta", "Back to [[Alpha]].\n"),
  "projects/trip/pages/plan.md": note("Plan", "Link [[Idea]].\n"),
  "projects/trip/cards/idea.md": note("Idea"),
  "projects/work/pages/plan.md": note("Plan", "Link [[Report]] and [[Plan]].\n"),
  "projects/work/pages/report.md": note("Report", "[[Plan]]"),
  "journal/2026/2026-09-23.md": note("2026-09-23"),
  "templates/page.md": note("Page template", "[[Beta]]"),
  "projects/trip/boards/map.canvas": board("projects/trip/cards/idea.md", "library/beta.md", "library/gone.md", "library/talk.deck"),
  "library/talk.deck": deck,
};

const ids = (g: VaultGraph) => g.nodes.map((n) => n.id);
const pairs = (g: VaultGraph) => g.edges.map((e) => `${g.nodes[e.from]!.id} > ${g.nodes[e.to]!.id}`).sort();
const edge = (g: VaultGraph, from: string, to: string) => g.edges.find((e) => g.nodes[e.from]!.id === from && g.nodes[e.to]!.id === to);

describe("the preview's link graph", () => {
  it("follows links by title, alias, embed and path, and makes ghosts of missing pages", async () => {
    const g = await new MemoryVault(SEED).graph({ kind: "vault" });
    expect(edge(g, "library/alpha.md", "library/beta.md")).toEqual({ from: expect.any(Number), to: expect.any(Number) });
    // A link and an embed of the same page are one edge, and a link wins.
    expect(g.edges.filter((e) => g.nodes[e.from]!.id === "library/alpha.md" && g.nodes[e.to]!.id === "library/beta.md")).toHaveLength(1);
    expect(pairs(g)).toContain("library/alpha.md > ghost:not written yet");
    expect(g.nodes.filter((n) => n.kind === "ghost")).toEqual([expect.objectContaining({ id: "ghost:not written yet", path: null, title: "not written yet", links: 1 })]);
    // A day that exists, a day that does not, a picture, and a template are no ghosts or nodes.
    expect(pairs(g)).toContain("library/alpha.md > journal/2026/2026-09-23.md");
    expect(ids(g)).not.toContain("templates/page.md");
    expect(g.edges.every((e) => e.from !== e.to)).toBe(true);
  });

  it("sends a shared title to the page in the linking page's project, and flags it elsewhere", async () => {
    const g = await new MemoryVault(SEED).graph({ kind: "vault" });
    expect(pairs(g)).toContain("projects/trip/pages/plan.md > projects/trip/cards/idea.md");
    expect(pairs(g)).toContain("projects/work/pages/report.md > projects/work/pages/plan.md");
    const flagged = g.edges.filter((e) => e.ambiguous).map((e) => `${g.nodes[e.from]!.id} > ${g.nodes[e.to]!.id}`);
    expect(flagged.sort()).toEqual(["library/alpha.md > projects/trip/pages/plan.md", "library/alpha.md > projects/work/pages/plan.md"]);
  });

  it("makes boards and decks nodes, a board linked to the cards it shows", async () => {
    const g = await new MemoryVault(SEED).graph({ kind: "vault" });
    const map = g.nodes.find((n) => n.id === "projects/trip/boards/map.canvas")!;
    expect(map).toMatchObject({ kind: "board", project: "trip", title: "map" });
    expect(edge(g, map.id, "projects/trip/cards/idea.md")).toMatchObject({ board: true });
    expect(edge(g, map.id, "library/talk.deck")).toMatchObject({ board: true });
    expect(g.nodes.find((n) => n.id === "library/talk.deck")).toMatchObject({ kind: "deck", title: "Talk" });
    expect(edge(g, "library/alpha.md", map.id)).toBeDefined();
    expect(edge(g, "library/alpha.md", "library/talk.deck")).toMatchObject({ embed: true });
    expect(pairs(g).some((p) => p.includes("gone.md"))).toBe(false);
  });

  it("counts each node's distinct neighbours", async () => {
    const g = await new MemoryVault(SEED).graph({ kind: "vault" });
    const links = (id: string) => g.nodes.find((n) => n.id === id)!.links;
    // Alpha and Beta link each other: one neighbour, not two.
    expect(links("library/beta.md")).toBe(2);
    expect(links("projects/work/pages/report.md")).toBe(1);
  });

  it("keeps a project's own pages and marks its outside neighbours", async () => {
    const g = await new MemoryVault(SEED).graph({ kind: "project", path: "projects/trip/_project.md" });
    expect(g.nodes.filter((n) => !n.outside).every((n) => n.project === "trip")).toBe(true);
    expect(g.nodes.filter((n) => n.outside).map((n) => n.id)).toContain("library/alpha.md");
    // Alpha to Beta joins two outsiders (Beta is on the board): not the project's.
    expect(pairs(g)).not.toContain("library/alpha.md > library/beta.md");
    const named = await new MemoryVault(SEED).graph({ kind: "project", path: "trip" });
    expect(named).toEqual(g);
  });

  it("reaches as far around a page as the depth says, in either direction", async () => {
    const vault = new MemoryVault({ "library/a.md": note("A", "[[B]]"), "library/b.md": note("B", "[[C]]"), "library/c.md": note("C"), "library/d.md": note("D", "[[C]] [[E]]"), "library/e.md": note("E") });
    const around = async (depth: number) => ids(await vault.graph({ kind: "around", path: "library/b.md", depth }));
    expect(await around(1)).toEqual(["library/a.md", "library/b.md", "library/c.md"]);
    expect(await around(2)).toEqual(["library/a.md", "library/b.md", "library/c.md", "library/d.md"]);
    expect(await around(9)).toHaveLength(5);
    expect(await around(0)).toEqual(await around(1));
    expect(ids(await vault.graph({ kind: "around", path: "library/zzz.md", depth: 1 }))).toEqual([]);
  });
});
