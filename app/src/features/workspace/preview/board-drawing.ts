// The browser preview's shapes, drawings and line styles, as the core keeps
// them (crates/kasten-core/src/board/drawing.rs): plain text nodes and
// edges, with what only Kasten draws under `x-kasten`, keyed by id.

import type { BoardDrawing, LineStyle, ShapeKind } from "../../../lib/vault/types";
import { newNodeId, type Canvas } from "./memory-extras";

type Item = Record<string, unknown>;

export const SHAPES: readonly ShapeKind[] = ["rect", "rounded", "ellipse", "diamond", "parallelogram", "cylinder", "hexagon", "document", "triangle"];
const LINES: readonly LineStyle[] = ["straight", "curve", "elbow"];
const MAX_POINTS = 5_000;
const MAX_OFFSET = 2 ** 24;

const isObject = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value);

function extras(canvas: Canvas): Item {
  const found = canvas["x-kasten"];
  if (found === undefined) return (canvas["x-kasten"] = {}) as Item;
  if (!isObject(found)) throw new Error("`x-kasten` on this board is not an object");
  return found;
}

function byId(canvas: Canvas, key: string): Item {
  const all = extras(canvas);
  if (all[key] === undefined) all[key] = {};
  const map = all[key];
  if (!isObject(map)) throw new Error(`\`x-kasten.${key}\` on this board is not an object`);
  return map;
}

function outline(value: string): ShapeKind {
  const v = value.trim();
  if ((SHAPES as readonly string[]).includes(v)) return v as ShapeKind;
  throw new Error(`KastenFlow draws ${SHAPES.join(", ")}, not “${v}”`);
}

function pen(size: number): number {
  if (Number.isInteger(size) && size >= 1 && size <= 32) return size;
  throw new Error(`A pen is 1 to 32 wide, not ${size}`);
}

function points(value: string): string {
  const pairs = value.split(/\s+/).filter(Boolean);
  const bad = () => new Error("A drawing's points are x,y pairs apart by spaces");
  if (pairs.length === 0) throw bad();
  if (pairs.length > MAX_POINTS) throw new Error(`A drawing has at most ${MAX_POINTS} points, not ${pairs.length}`);
  for (const pair of pairs) {
    const parts = pair.split(",");
    if (parts.length !== 2 || parts.some((n) => !/^-?\d+$/.test(n) || Math.abs(Number(n)) > MAX_OFFSET)) throw bad();
  }
  return pairs.join(" ");
}

function textNode(canvas: Canvas, id: string): Item {
  const node = canvas.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`No node ${id} on this board`);
  if (node.type !== "text") throw new Error("Only a text node takes a shape or a drawing");
  return node;
}

export function addShape(canvas: Canvas, shape: string, text: string, box: { x: number; y: number; width: number; height: number }): string {
  const kind = outline(shape);
  const id = newNodeId(canvas);
  canvas.nodes.push({ id, type: "text", text, ...box });
  byId(canvas, "shape")[id] = kind;
  return id;
}

export function reshape(canvas: Canvas, id: string, shape: string) {
  textNode(canvas, id);
  if (!shape.trim()) delete byId(canvas, "shape")[id];
  else byId(canvas, "shape")[id] = outline(shape);
}

export function addDrawing(canvas: Canvas, stroke: string, size: number, color: string | undefined, box: { x: number; y: number; width: number; height: number }): string {
  const drawn = { points: points(stroke), size: pen(size) };
  const id = newNodeId(canvas);
  canvas.nodes.push({ id, type: "text", text: "", ...box, ...(color ? { color } : {}) });
  byId(canvas, "draw")[id] = drawn;
  return id;
}

export function styleLine(canvas: Canvas, id: string, line: string | undefined, dash: boolean | undefined) {
  if (!canvas.edges.some((e) => e.id === id)) throw new Error(`No edge ${id} on this board`);
  if (line !== undefined) {
    const v = line.trim();
    if (!v) delete byId(canvas, "line")[id];
    else if ((LINES as readonly string[]).includes(v)) byId(canvas, "line")[id] = v;
    else throw new Error(`A line is straight, curve or elbow, not “${v}”`);
  }
  if (dash !== undefined) {
    const all = extras(canvas);
    const ids = Array.isArray(all.dash) ? (all.dash as unknown[]).filter((v) => v !== id) : [];
    if (dash) ids.push(id);
    all.dash = ids;
  }
}

/** Puts back what `x-kasten` said about a node or edge, given with it. */
export function restoreExtras(canvas: Canvas, id: string, said: Item) {
  if (typeof said.shape === "string") reshape(canvas, id, said.shape);
  if (isObject(said.draw)) {
    textNode(canvas, id);
    byId(canvas, "draw")[id] = { points: points(String(said.draw.points ?? "")), size: pen(Number(said.draw.size)) };
  }
  const line = typeof said.line === "string" ? said.line : undefined;
  const dash = typeof said.dash === "boolean" ? said.dash : undefined;
  if (line !== undefined || dash !== undefined) styleLine(canvas, id, line, dash);
}

/** Drops what `x-kasten` says about nodes and edges that are gone. */
export function forgetDrawn(canvas: Canvas, gone: Set<string>) {
  const all = canvas["x-kasten"];
  if (!isObject(all)) return;
  for (const key of ["shape", "draw", "line"]) {
    const map = all[key];
    if (isObject(map)) for (const id of gone) delete map[id];
  }
  if (Array.isArray(all.dash)) all.dash = all.dash.filter((v) => typeof v !== "string" || !gone.has(v));
}

const said = (canvas: Canvas, key: string, id: string): unknown => {
  const all = canvas["x-kasten"];
  const map = isObject(all) ? all[key] : undefined;
  return isObject(map) ? map[id] : undefined;
};

export function shapeOf(canvas: Canvas, id: string): ShapeKind | undefined {
  const value = said(canvas, "shape", id);
  return typeof value === "string" && (SHAPES as readonly string[]).includes(value) ? (value as ShapeKind) : undefined;
}

export function drawingOf(canvas: Canvas, id: string): BoardDrawing | undefined {
  const value = said(canvas, "draw", id);
  return isObject(value) && typeof value.points === "string" && typeof value.size === "number" ? { points: value.points, size: value.size } : undefined;
}

export function lineOf(canvas: Canvas, id: string): LineStyle | undefined {
  const value = said(canvas, "line", id);
  return typeof value === "string" && (LINES as readonly string[]).includes(value) ? (value as LineStyle) : undefined;
}

export function dashed(canvas: Canvas, id: string): boolean {
  const all = canvas["x-kasten"];
  return isObject(all) && Array.isArray(all.dash) && all.dash.includes(id);
}
