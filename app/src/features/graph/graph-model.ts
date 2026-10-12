// The graph the view draws: the core's graph with the person's filters
// applied, its neighbours worked out, and the small decisions about how a node
// looks (its size from its links, its colour from its kind or project, which
// nodes to name at a given zoom). Pure functions, unit tested.

import type { GraphEdge, GraphNode, GraphScope, VaultGraph } from "../../lib/vault/types";
import { kindColor } from "../library/kind-tile";

export interface GraphFilters {
  /** Show pages with no links in or out. */
  orphans: boolean;
  /** Show the pages links name that do not exist yet. */
  ghosts: boolean;
  /** Kinds left out (`page`, `card`, `journal`, `board`…). */
  hiddenKinds: readonly string[];
  /** Tags a page must carry, lower case; with none, any page. Boards, decks and ghosts carry none. */
  tags: readonly string[];
}

export const SHOW_ALL: GraphFilters = { orphans: true, ghosts: true, hiddenKinds: [], tags: [] };

export const hasFilters = (f: GraphFilters) => !f.orphans || !f.ghosts || f.hiddenKinds.length > 0 || f.tags.length > 0;

/** What the view draws. Indices are into `nodes`. */
export interface Model {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Each node's place in the graph the model was made from. */
  origin: number[];
  /** Each node's neighbours, linked in either direction, once each. */
  neighbours: number[][];
}

export function modelOf(graph: VaultGraph, filters: GraphFilters, tagsOf: (path: string) => readonly string[] = () => []): Model {
  const hidden = new Set(filters.hiddenKinds);
  const wanted = filters.tags.map((t) => t.toLowerCase());
  const keep = graph.nodes.map((node) => {
    if (hidden.has(node.kind) || (node.kind === "ghost" && !filters.ghosts)) return false;
    if (!filters.orphans && node.links === 0) return false;
    if (wanted.length === 0) return true;
    if (node.path === null) return false;
    const has = new Set(tagsOf(node.path).map((t) => t.toLowerCase()));
    return wanted.every((t) => has.has(t));
  });
  const moved: number[] = [];
  const nodes: GraphNode[] = [];
  const origin: number[] = [];
  graph.nodes.forEach((node, i) => {
    if (!keep[i]) return;
    moved[i] = nodes.length;
    nodes.push(node);
    origin.push(i);
  });
  const edges: GraphEdge[] = [];
  const neighbours: number[][] = nodes.map(() => []);
  const seen = new Set<number>();
  for (const edge of graph.edges) {
    const [from, to] = [moved[edge.from], moved[edge.to]];
    if (from === undefined || to === undefined) continue;
    edges.push({ ...edge, from, to });
    const pair = Math.min(from, to) * nodes.length + Math.max(from, to);
    if (seen.has(pair)) continue;
    seen.add(pair);
    neighbours[from]!.push(to);
    neighbours[to]!.push(from);
  }
  return { nodes, edges, origin, neighbours };
}

/** A node and the nodes it is linked with, for the highlight under the pointer. */
export function neighbourhood(model: Model, index: number): Set<number> {
  return new Set([index, ...(model.neighbours[index] ?? [])]);
}

/** A node's radius in graph units: more links, a bigger dot, up to a limit. */
export function radiusOf(links: number): number {
  return Math.min(14, 3.5 + Math.sqrt(Math.max(0, links)) * 1.5);
}

export type ColourBy = "kind" | "project";

/** The highlight colours a project can take, in the order projects are given them. */
const PROJECT_COLOURS = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown"] as const;

/** The colours of the kinds that are not notes. */
const FILE_COLOURS: Record<string, string> = { board: "brown", deck: "red", diagram: "orange", ghost: "gray" };

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The highlight colour (a palette name) a node is drawn in. */
export function colourOf(node: GraphNode, by: ColourBy): string {
  if (node.kind === "ghost") return "gray";
  if (by === "project") return node.project ? PROJECT_COLOURS[hash(node.project) % PROJECT_COLOURS.length]! : "gray";
  return FILE_COLOURS[node.kind] ?? kindColor(node.kind);
}

export const KIND_LABELS: Record<string, string> = {
  page: "Pages",
  card: "Cards",
  journal: "Journal days",
  project: "Projects",
  chat: "Chats",
  highlight: "Highlights",
  board: "Whiteboards",
  deck: "Decks",
  diagram: "Diagrams",
  ghost: "Missing pages",
};

export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

/** The kinds in a graph with how many of each, the most first. */
export function kindCounts(graph: VaultGraph): { kind: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const node of graph.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  return [...counts]
    .map(([kind, count]) => ({ kind, label: kindLabel(kind), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The nodes whose titles match what was typed, the best first: titles that start with it, then words that do, then the rest; the most linked first within each. */
export function findNodes(model: Model, query: string, limit = 8): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: { index: number; rank: number }[] = [];
  model.nodes.forEach((node, index) => {
    const title = node.title.toLowerCase();
    const at = title.indexOf(q);
    if (at < 0) return;
    const rank = at === 0 ? 0 : /[\s\-_/(]/.test(title[at - 1]!) ? 1 : 2;
    ranked.push({ index, rank });
  });
  ranked.sort((a, b) => a.rank - b.rank || model.nodes[b.index]!.links - model.nodes[a.index]!.links || model.nodes[a.index]!.title.localeCompare(model.nodes[b.index]!.title));
  return ranked.slice(0, limit).map((r) => r.index);
}

/** What the zoom shows names of: at `zoom` (1 is the graph's own size) the nodes with at least this many links are named; zero names every node. A node under the pointer or selected is always named. */
export function labelThreshold(zoom: number, count: number): number {
  if (zoom < 0.35) return Infinity;
  if (zoom < 0.6) return 12;
  if (zoom < 0.9) return 6;
  if (zoom < 1.4) return count > 400 ? 3 : 1;
  if (zoom < 2) return count > 2000 ? 2 : 0;
  return 0;
}

/** A key for a scope, to keep what belongs to it (where its nodes were left). */
export function scopeKey(scope: GraphScope): string {
  switch (scope.kind) {
    case "vault":
      return "vault";
    case "project":
      return `project:${scope.path}`;
    case "around":
      return `around:${scope.path}:${scope.depth}`;
  }
}

/** The index of the node that is `id`, or -1. */
export const indexOfId = (model: Model, id: string) => model.nodes.findIndex((n) => n.id === id);

/** The neighbour of `from` that lies most nearly in the direction (dx, dy) in the picture, for arrow keys; -1 when none lies that way. */
export function neighbourToward(model: Model, positions: ArrayLike<number>, from: number, dx: number, dy: number): number {
  let best = -1;
  let bestScore = 0.35;
  const [fx, fy] = [positions[2 * from]!, positions[2 * from + 1]!];
  for (const other of model.neighbours[from] ?? []) {
    const [vx, vy] = [positions[2 * other]! - fx, positions[2 * other + 1]! - fy];
    const length = Math.hypot(vx, vy) || 1;
    // The cosine of the angle between where it lies and where the key points.
    const score = (vx * dx + vy * dy) / (length * (Math.hypot(dx, dy) || 1));
    if (score > bestScore) [best, bestScore] = [other, score];
  }
  return best;
}
