// The browser preview's `x-kasten` board state, as the core keeps it
// (crates/kasten-core/src/board/extras.rs): folded sections in
// `collapsed`, card display sizes in `cardSize`, putting back removed
// nodes and edges for undo, and cards following notes that move.

import type { BoardSource } from "../../../lib/vault/types";
import { restoreExtras } from "./board-drawing";
import { readCanvas, writeCanvas, type Canvas } from "./memory-extras";

type Item = Record<string, unknown>;

interface Extras {
  collapsed?: unknown;
  cardSize?: unknown;
  [key: string]: unknown;
}

const isObject = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value);

function extras(canvas: Canvas): Extras {
  const found = canvas["x-kasten"];
  if (found === undefined) return (canvas["x-kasten"] = {}) as Extras;
  if (!isObject(found)) throw new Error("`x-kasten` on this board is not an object");
  return found;
}

export function cardSizeOf(canvas: Canvas, id: string): "title" | "expanded" | undefined {
  const sizes = (canvas["x-kasten"] as Extras | undefined)?.cardSize;
  const size = isObject(sizes) ? sizes[id] : undefined;
  return size === "title" || size === "expanded" ? size : undefined;
}

export function isCollapsed(canvas: Canvas, id: string): boolean {
  const ids = (canvas["x-kasten"] as Extras | undefined)?.collapsed;
  return Array.isArray(ids) && ids.includes(id);
}

function nodeOf(canvas: Canvas, id: string): Item {
  const node = canvas.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`No node ${id} on this board`);
  return node;
}

export function setCardSize(canvas: Canvas, id: string, size: "title" | "expanded" | null) {
  if (nodeOf(canvas, id).type !== "file") throw new Error("Only a card has a display size");
  if (size !== null && size !== "title" && size !== "expanded") throw new Error(`A card shows its title or expanded, not “${String(size)}”`);
  const all = extras(canvas);
  if (!isObject(all.cardSize)) all.cardSize = {};
  const sizes = all.cardSize as Item;
  if (size === null) delete sizes[id];
  else sizes[id] = size;
}

export function setCollapsed(canvas: Canvas, id: string, collapsed: boolean) {
  if (nodeOf(canvas, id).type !== "group") throw new Error("Only a section folds");
  const all = extras(canvas);
  if (!Array.isArray(all.collapsed)) all.collapsed = [];
  const ids = all.collapsed as unknown[];
  if (collapsed && !ids.includes(id)) ids.push(id);
  if (!collapsed) all.collapsed = ids.filter((v) => v !== id);
}

/** The most branches a source may remember (the core's `MAX_BRANCHES`). */
const MAX_BRANCHES = 1_000;

/** What the board remembers about the page it was made from, if anything. */
export function sourceOf(canvas: Canvas): BoardSource | undefined {
  const found = (canvas["x-kasten"] as Extras | undefined)?.source;
  return isObject(found) && typeof found.page === "string" ? (found as unknown as BoardSource) : undefined;
}

/** Sets or, with null, forgets the board's source, checked as the core's
 * `set_source` does: an object naming its page, branches an object of objects. */
export function setSource(canvas: Canvas, source: BoardSource | null) {
  if (source === null) {
    const all = canvas["x-kasten"];
    if (isObject(all)) delete all.source;
    return;
  }
  if (!isObject(source)) throw new Error("A board's source is an object naming its page");
  if (typeof source.page !== "string" || !source.page.trim()) throw new Error("A board's source names its page");
  const branches = (source as Item).branches;
  if (branches !== undefined) {
    if (!isObject(branches)) throw new Error("A source's branches are an object, by node id");
    if (Object.keys(branches).length > MAX_BRANCHES) throw new Error(`A board's source remembers at most ${MAX_BRANCHES} branches, not ${Object.keys(branches).length}`);
    if (!Object.values(branches).every(isObject)) throw new Error("Each of a source's branches is an object");
  }
  extras(canvas).source = structuredClone(source);
}

/** Drops what `x-kasten` says about nodes that are gone. */
export function forget(canvas: Canvas, gone: Set<string>) {
  const all = canvas["x-kasten"];
  if (!isObject(all)) return;
  if (isObject(all.cardSize)) for (const id of gone) delete all.cardSize[id];
  if (Array.isArray(all.collapsed)) all.collapsed = all.collapsed.filter((v) => typeof v !== "string" || !gone.has(v));
}

/** Points every board's cards at notes that moved, as the core's
 * `relink_boards` does on a rename or move: `moves` holds old and new
 * paths. Boards that change are written back; their paths are returned. */
export function relinkBoards(boards: Record<string, string> | undefined, moves: readonly (readonly [string, string])[]): string[] {
  const to = new Map(moves.filter(([from, next]) => from !== next));
  if (!boards || to.size === 0) return [];
  const changed: string[] = [];
  for (const [path, text] of Object.entries(boards)) {
    const canvas = readCanvas(text);
    let hits = 0;
    for (const node of canvas.nodes) {
      const next = node.type === "file" ? to.get(String(node.file)) : undefined;
      if (next === undefined) continue;
      node.file = next;
      hits++;
    }
    if (hits === 0) continue;
    boards[path] = writeCanvas(canvas);
    changed.push(path);
  }
  return changed.sort();
}

/** Puts back nodes and edges as they were; sections go to the back. What
 * `x-kasten` said about each may come with it under its own `x-kasten`. */
export function restore(canvas: Canvas, givenNodes: Item[], givenEdges: Item[]) {
  const said: [string, Item][] = [];
  const plain = (item: Item): Item => {
    const { "x-kasten": extra, ...rest } = item;
    if (isObject(extra) && typeof rest.id === "string") said.push([rest.id, extra]);
    return rest;
  };
  const nodes = givenNodes.map(plain);
  const edges = givenEdges.map(plain);
  const taken = new Set([...canvas.nodes, ...canvas.edges].map((item) => String(item.id)));
  // Sections go to the back in the order given, so their stacking holds.
  let back = 0;
  for (const node of nodes) {
    const id = typeof node.id === "string" ? node.id : "";
    if (!id || typeof node.type !== "string" || typeof node.x !== "number" || typeof node.y !== "number") throw new Error(`Not a board node: ${JSON.stringify(node)}`);
    if (taken.has(id)) throw new Error(`Node ${id} is already on this board`);
    taken.add(id);
    if (node.type === "group") canvas.nodes.splice(back++, 0, { ...node });
    else canvas.nodes.push({ ...node });
  }
  for (const edge of edges) {
    const id = typeof edge.id === "string" ? edge.id : "";
    if (!id) throw new Error(`Not a board edge: ${JSON.stringify(edge)}`);
    for (const end of [edge.fromNode, edge.toNode]) nodeOf(canvas, String(end ?? ""));
    if (taken.has(id)) throw new Error(`Edge ${id} is already on this board`);
    taken.add(id);
    canvas.edges.push({ ...edge });
  }
  for (const [id, extra] of said) restoreExtras(canvas, id, extra);
}
