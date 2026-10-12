import { describe, expect, it } from "vitest";

import type { BoardNode } from "../../../../lib/vault/types";
import { applyChanges, type BoardDoc } from "./apply";
import { TITLE_HEIGHT } from "./geometry";
import { Z, flowKind, toFlowEdges, toFlowNodes } from "./flow";
import { reconcile } from "./reconcile";
import { hiddenIds } from "./sections";

const nodes: BoardNode[] = [
  { id: "a", kind: "file", file: "library/a.md", x: 0, y: 0, width: 320, height: 180, size: "title" },
  { id: "small", kind: "group", label: "Small", x: -20, y: -60, width: 400, height: 300 },
  { id: "img", kind: "file", file: "assets/cat.png", x: 400, y: 0, width: 200, height: 200 },
  { id: "big", kind: "group", label: "Big", x: -100, y: -200, width: 1400, height: 900, collapsed: true },
  { id: "nested", kind: "file", file: "library/inner.canvas", x: 800, y: 0, width: 320, height: 180 },
  { id: "far", kind: "text", text: "Far away", x: 5000, y: 0, width: 260, height: 120 },
  { id: "pdf", kind: "file", file: "sources/paper.pdf", x: 5000, y: 400, width: 320, height: 180 },
  { id: "web", kind: "link", url: "https://example.com", x: 5400, y: 0, width: 320, height: 180 },
];
const doc: BoardDoc = {
  path: "library/b.canvas",
  title: "B",
  nodes,
  edges: [
    { id: "e1", from: "a", to: "far" },
    { id: "e2", from: "far", to: "web", fromSide: "bottom", toSide: "top" },
  ],
};

describe("the board as React Flow draws it", () => {
  it("draws sections first, larger behind smaller, sections below edges below cards", () => {
    const flow = toFlowNodes(doc, [], new Set());
    expect(flow.map((n) => n.id)).toEqual(["big", "small", "a", "img", "nested", "far", "pdf", "web"]);
    expect(flow.map((n) => n.type)).toEqual(["section", "section", "card", "image", "board", "sticky", "file", "link"]);
    expect(flow[0]!.zIndex).toBeLessThan(Z.edge);
    expect(flow[2]!.zIndex).toBeGreaterThan(Z.edge);
    expect(flowKind({ id: "x", kind: "weird", x: 0, y: 0, width: 1, height: 1 })).toBe("card");
  });

  it("draws a diagram's file as a diagram, and its picture on its own as an ordinary image", () => {
    const at = { x: 0, y: 0, width: 1, height: 1 };
    expect(flowKind({ id: "d", kind: "file", file: "library/Flow.drawio", ...at })).toBe("diagram");
    expect(flowKind({ id: "p", kind: "file", file: "assets/Flow.drawio.svg", ...at })).toBe("image");
    expect(flowKind({ id: "o", kind: "file", file: "library/Flow.drawio.bak", ...at })).toBe("file");
  });

  it("gives every node its size and side handles, so nothing is measured", () => {
    const [card] = toFlowNodes(doc, [], new Set()).filter((n) => n.id === "a");
    expect(card).toMatchObject({ width: 320, height: TITLE_HEIGHT, measured: { width: 320, height: TITLE_HEIGHT } });
    expect(card!.handles!.map((h) => [h.id, h.x, h.y])).toEqual([["top", 0, 0], ["right", 320, 0], ["bottom", 0, TITLE_HEIGHT], ["left", 0, 0]]);
  });

  it("hides what folded sections hold, and the edges to it", () => {
    const hidden = hiddenIds(doc.nodes);
    expect([...hidden].sort()).toEqual(["a", "img", "nested", "small"]);
    const flow = toFlowNodes(doc, [], hidden);
    expect(flow.filter((n) => n.hidden).map((n) => n.id).sort()).toEqual(["a", "img", "nested", "small"]);
    const edges = toFlowEdges(doc, [], hidden);
    expect(edges.map((e) => [e.id, Boolean(e.hidden)])).toEqual([["e1", true], ["e2", false]]);
  });

  it("joins the named sides, or the ones facing each other", () => {
    const edges = toFlowEdges(doc, [], new Set());
    expect(edges.map((e) => [e.sourceHandle, e.targetHandle])).toEqual([["right", "left"], ["bottom", "top"]]);
  });

  it("keeps the objects, and the selection, of what did not change", () => {
    const first = toFlowNodes(doc, [], new Set()).map((n) => (n.id === "far" ? { ...n, selected: true } : n));
    const moved = applyChanges(doc, [{ kind: "place", id: "web", x: 1, y: 2 }]);
    const second = toFlowNodes(moved, first, new Set());
    expect(second.filter((n, i) => n === first[i]).length).toBe(nodes.length - 1);
    const web = second.find((n) => n.id === "web")!;
    expect(web.position).toEqual({ x: 1, y: 2 });
    const selected = toFlowNodes(applyChanges(doc, [{ kind: "text", id: "far", text: "Near" }]), first, new Set()).find((n) => n.id === "far")!;
    expect(selected).toMatchObject({ selected: true, zIndex: Z.lifted });
    const edges = toFlowEdges(doc, [], new Set());
    expect(toFlowEdges(moved, edges, new Set())[1]).toBe(edges[1]);
  });

  it("keeps a fresh read's objects where nothing changed", () => {
    const fresh: BoardDoc = JSON.parse(JSON.stringify(doc));
    expect(reconcile(doc, fresh)).toBe(doc);
    fresh.nodes[1]!.label = "Renamed";
    const next = reconcile(doc, fresh);
    expect(next).not.toBe(doc);
    expect(next.nodes.filter((n, i) => n === doc.nodes[i]).length).toBe(nodes.length - 1);
    expect(next.edges).toBe(doc.edges);
  });
});
