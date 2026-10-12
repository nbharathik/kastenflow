// The board as React Flow draws it. Every node has a fixed size, so React
// Flow is told the size and where each side's handle sits instead of
// measuring 500 nodes in the page. Nodes and edges that did not change keep
// their objects (and with them their selection), so only what changed is
// drawn again.

import { Position, type Edge, type Node, type NodeHandle } from "@xyflow/react";

import type { BoardEdge, BoardNode, BoardSide } from "../../../../lib/vault/types";
import type { BoardDoc } from "./apply";
import { area, facingSides, shownRect } from "./geometry";

export type FlowKind = "card" | "sticky" | "shape" | "drawing" | "section" | "link" | "image" | "diagram" | "board" | "file";

export interface NodeData extends Record<string, unknown> {
  node: BoardNode;
}
export interface EdgeData extends Record<string, unknown> {
  edge: BoardEdge;
}
export type FlowNode = Node<NodeData, FlowKind>;
export type FlowEdge = Edge<EdgeData, "board">;

/** Sections sit behind edges, and edges behind everything else. */
export const Z = { section: 0, edge: 1, node: 2, lifted: 3 } as const;

export const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

export function flowKind(node: BoardNode): FlowKind {
  if (node.kind === "text") return node.draw ? "drawing" : node.shape ? "shape" : "sticky";
  if (node.kind === "group") return "section";
  if (node.kind === "link") return "link";
  const file = node.file ?? "";
  if (node.kind !== "file" || file.endsWith(".md")) return "card";
  if (file.endsWith(".canvas")) return "board";
  // A diagram shows the picture kept beside it; a `.drawio.svg` on its own is an ordinary picture.
  if (file.endsWith(".drawio")) return "diagram";
  return IMAGE.test(file) ? "image" : "file";
}

/** The four side handles, as zero-width lines along each side, so an edge
 * meets the middle of the side it names. */
export function sideHandles(width: number, height: number): NodeHandle[] {
  return [
    { id: "top", type: "source", position: Position.Top, x: 0, y: 0, width, height: 0 },
    { id: "right", type: "source", position: Position.Right, x: width, y: 0, width: 0, height },
    { id: "bottom", type: "source", position: Position.Bottom, x: 0, y: height, width, height: 0 },
    { id: "left", type: "source", position: Position.Left, x: 0, y: 0, width: 0, height },
  ];
}

/** `node` at a new size, with its handles along the new sides. */
export function resized<T extends Node>(node: T, width: number, height: number): T {
  return { ...node, width, height, measured: { width, height }, handles: sideHandles(width, height) };
}

const zOf = (node: BoardNode, selected: boolean) => (node.kind === "group" ? Z.section : selected ? Z.lifted : Z.node);

/** A section lets clicks through its middle to the board below it: only
 * its label bar and resize handles catch the pointer. */
const PASS_THROUGH = { pointerEvents: "none" } as const;

function flowNode(node: BoardNode, old: FlowNode | undefined, hidden: boolean): FlowNode {
  const r = shownRect(node);
  const selected = old?.selected ?? false;
  const out: FlowNode = resized(
    {
      id: node.id,
      type: flowKind(node),
      position: { x: r.x, y: r.y },
      data: { node },
      zIndex: zOf(node, selected),
      selected,
    },
    r.width,
    r.height,
  );
  if (hidden) out.hidden = true;
  if (node.kind === "group") {
    out.dragHandle = ".kasten-section-bar";
    out.style = PASS_THROUGH;
  }
  return out;
}

/** The nodes to draw: sections first, larger behind smaller, then the rest
 * in the board's order. */
export function toFlowNodes(doc: BoardDoc, prev: readonly FlowNode[], hidden: ReadonlySet<string>): FlowNode[] {
  const before = new Map(prev.map((n) => [n.id, n]));
  const sections = doc.nodes.filter((n) => n.kind === "group").sort((a, b) => area(b) - area(a));
  const others = doc.nodes.filter((n) => n.kind !== "group");
  return [...sections, ...others].map((node) => {
    const old = before.get(node.id);
    const isHidden = hidden.has(node.id);
    if (old && old.data.node === node && Boolean(old.hidden) === isHidden) return old;
    return flowNode(node, old, isHidden);
  });
}

/** The sides an edge joins: the ones it names, else the ones facing. */
export function edgeSides(edge: BoardEdge, from: BoardNode, to: BoardNode): [BoardSide, BoardSide] {
  if (edge.fromSide && edge.toSide) return [edge.fromSide, edge.toSide];
  const [a, b] = facingSides(shownRect(from), shownRect(to));
  return [edge.fromSide ?? a, edge.toSide ?? b];
}

export function toFlowEdges(doc: BoardDoc, prev: readonly FlowEdge[], hidden: ReadonlySet<string>): FlowEdge[] {
  const before = new Map(prev.map((e) => [e.id, e]));
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const out: FlowEdge[] = [];
  for (const edge of doc.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const [sourceHandle, targetHandle] = edgeSides(edge, from, to);
    const isHidden = hidden.has(edge.from) || hidden.has(edge.to);
    const old = before.get(edge.id);
    if (old && old.data?.edge === edge && old.sourceHandle === sourceHandle && old.targetHandle === targetHandle && Boolean(old.hidden) === isHidden) {
      out.push(old);
      continue;
    }
    const next: FlowEdge = { id: edge.id, source: edge.from, target: edge.to, sourceHandle, targetHandle, type: "board", data: { edge }, zIndex: Z.edge, selected: old?.selected ?? false };
    if (isHidden) next.hidden = true;
    out.push(next);
  }
  return out;
}
