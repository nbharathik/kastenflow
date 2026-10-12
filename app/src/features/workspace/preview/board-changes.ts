// The browser preview's board edits: the core's `BoardChange` batch
// (crates/kasten-core/src/board/change.rs) on a canvas in memory, applied
// whole or not at all, with the same checks and messages.

import type { BoardChange, BoardEnd, BoardSide } from "../../../lib/vault/types";
import { addDrawing, addShape, forgetDrawn, reshape, styleLine } from "./board-drawing";
import { forget, restore, setCardSize, setCollapsed, setSource } from "./board-extras";
import { group, newNodeId, type Canvas } from "./memory-extras";

/** Numbers beyond any real board. */
const LIMIT = 2 ** 40;
const CARD = { width: 320, height: 180 };
const STICKY = { width: 260, height: 120 };

type Item = Record<string, unknown>;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(node: Item): Rect {
  const n = (key: string) => Number(node[key]) || 0;
  return { x: n("x"), y: n("y"), width: Math.max(0, n("width")), height: Math.max(0, n("height")) };
}

/** The sides an edge leaves and enters when none are given: the ones facing
 * each other along the axis where the centres are further apart. */
export function facingSides(from: Rect, to: Rect): [BoardSide, BoardSide] {
  const dx = 2 * to.x + to.width - (2 * from.x + from.width);
  const dy = 2 * to.y + to.height - (2 * from.y + from.height);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function colour(value: string): string {
  const v = value.trim();
  if (/^[1-6]$/.test(v) || /^#[0-9a-f]{6}$/i.test(v)) return v;
  throw new Error(`Not a board colour: ${v} (use 1 to 6 or #rrggbb)`);
}

function side(value: string): BoardSide {
  if (value === "top" || value === "right" || value === "bottom" || value === "left") return value;
  throw new Error(`Not a side of a node: ${value} (use top, right, bottom or left)`);
}

function end(value: string): BoardEnd {
  if (value === "none" || value === "arrow") return value;
  throw new Error(`An edge ends in none or arrow, not ${value}`);
}

/** http and https only, so a card cannot hide a script. */
export function webAddress(value: string): string {
  const url = value.trim();
  if (/^https?:\/\/.*\S/i.test(url)) return url;
  throw new Error(`Not a web address: ${value} (links start with https://)`);
}

function position(x: number, y: number) {
  if (Math.abs(x) > LIMIT || Math.abs(y) > LIMIT) throw new Error(`Too far out on the board: ${x}, ${y}`);
  return { x: Math.round(x), y: Math.round(y) };
}

function size(width: number, height: number) {
  const ok = (n: number) => n >= 1 && n <= LIMIT;
  if (!ok(width) || !ok(height)) throw new Error(`A node's size must be above zero, not ${width}×${height}`);
  return { width: Math.round(width), height: Math.round(height) };
}

const noNode = (id: string) => new Error(`No node ${id} on this board`);

/** Sets `key`, or removes it when `value` is empty. */
function setOrClear(item: Item, key: string, value: string) {
  if (value) item[key] = value;
  else delete item[key];
}

/** Connects two nodes by id, reusing an edge that already joins them with the
 * same label, either way round. */
export function connect(canvas: Canvas, from: string, to: string, label?: string, sides: [BoardSide?, BoardSide?] = []): string {
  const start = canvas.nodes.find((n) => n.id === from);
  const finish = canvas.nodes.find((n) => n.id === to);
  if (!start) throw noNode(from);
  if (!finish) throw noNode(to);
  if (from === to) throw new Error("A connection needs two different nodes");
  const text = label?.trim() ?? "";
  const same = canvas.edges.find(
    (e) => ((e.fromNode === from && e.toNode === to) || (e.fromNode === to && e.toNode === from)) && String(e.label ?? "").trim() === text,
  );
  if (same) return String(same.id);
  const [fromFacing, toFacing] = facingSides(rectOf(start), rectOf(finish));
  const id = newNodeId(canvas);
  canvas.edges.push({ id, fromNode: from, fromSide: sides[0] ?? fromFacing, toNode: to, toSide: sides[1] ?? toFacing, ...(text ? { label: text } : {}) });
  return id;
}

/** Applies `changes` in order, all of them or none. Returns the id each
 * change that makes something made or reused. */
export function applyChanges(canvas: Canvas, changes: BoardChange[]): string[] {
  const next = structuredClone(canvas);
  const made: string[] = [];
  for (const change of changes) {
    const id = applyOne(next, change);
    if (id !== null) made.push(id);
  }
  Object.assign(canvas, next);
  return made;
}

function applyOne(canvas: Canvas, change: BoardChange): string | null {
  const node = (id: string) => canvas.nodes.find((n) => n.id === id);
  switch (change.kind) {
    case "place": {
      const at = position(change.x, change.y);
      const found = node(change.id);
      if (!found) throw noNode(change.id);
      const old = rectOf(found);
      const resized = change.width !== undefined || change.height !== undefined ? size(change.width ?? old.width, change.height ?? old.height) : null;
      Object.assign(found, at, resized ?? {});
      return null;
    }
    case "remove": {
      const gone = new Set(change.ids);
      // Edges go with their nodes, and so does their styling.
      for (const e of canvas.edges) if (gone.has(String(e.fromNode)) || gone.has(String(e.toNode))) gone.add(String(e.id));
      canvas.nodes = canvas.nodes.filter((n) => !gone.has(String(n.id)));
      canvas.edges = canvas.edges.filter((e) => !gone.has(String(e.fromNode)) && !gone.has(String(e.toNode)));
      forget(canvas, gone);
      forgetDrawn(canvas, gone);
      return null;
    }
    case "text": {
      const found = node(change.id);
      if (!found) throw noNode(change.id);
      if (found.type === "text") found.text = change.text;
      else if (found.type === "group") setOrClear(found, "label", change.text.trim());
      else if (found.type === "link") found.url = webAddress(change.text);
      else if (found.type === "file") throw new Error("A card shows its note; edit the note instead");
      else throw new Error(`Node ${change.id} has no text to edit`);
      return null;
    }
    case "color": {
      const value = change.color == null ? "" : colour(change.color);
      for (const id of change.ids) {
        const item = node(id) ?? canvas.edges.find((e) => e.id === id);
        if (!item) throw noNode(id);
        setOrClear(item, "color", value);
      }
      return null;
    }
    case "sticky": {
      const id = newNodeId(canvas);
      canvas.nodes.push({ id, type: "text", text: change.text, ...position(change.x, change.y), ...STICKY });
      return id;
    }
    case "card": {
      const path = change.path.trim();
      const shown = canvas.nodes.find((n) => n.type === "file" && n.file === path);
      if (shown) return String(shown.id);
      const shape = change.width !== undefined && change.height !== undefined ? size(change.width, change.height) : CARD;
      const id = newNodeId(canvas);
      canvas.nodes.push({ id, type: "file", file: path, ...position(change.x, change.y), ...shape });
      return id;
    }
    case "link": {
      const url = webAddress(change.url);
      const id = newNodeId(canvas);
      canvas.nodes.push({ id, type: "link", url, ...position(change.x, change.y), ...CARD });
      return id;
    }
    case "section": {
      const at = position(change.x, change.y);
      const box = size(change.width, change.height);
      const id = newNodeId(canvas);
      const label = change.label.trim();
      canvas.nodes.unshift({ id, type: "group", ...(label ? { label } : {}), ...at, ...box });
      return id;
    }
    case "wrap": {
      for (const id of change.ids) if (!node(id)) throw noNode(id);
      return group(canvas, change.ids, change.label);
    }
    case "connect": {
      const sides: [BoardSide?, BoardSide?] = [change.fromSide && side(change.fromSide), change.toSide && side(change.toSide)];
      return connect(canvas, change.from, change.to, change.label, sides);
    }
    case "edge": {
      const cleared = (value: string | undefined, check: (v: string) => string) => (value === undefined ? undefined : value.trim() ? check(value.trim()) : "");
      const color = cleared(change.color, colour);
      const fromEnd = cleared(change.fromEnd, end);
      const toEnd = cleared(change.toEnd, end);
      const fromSide = cleared(change.fromSide, side);
      const toSide = cleared(change.toSide, side);
      const edge = canvas.edges.find((e) => e.id === change.id);
      if (!edge) throw new Error(`No edge ${change.id} on this board`);
      if (change.label !== undefined) setOrClear(edge, "label", change.label.trim());
      const fields = [["color", color], ["fromEnd", fromEnd], ["toEnd", toEnd], ["fromSide", fromSide], ["toSide", toSide]] as const;
      for (const [key, value] of fields) if (value !== undefined) setOrClear(edge, key, value);
      return null;
    }
    case "card_size":
      setCardSize(canvas, change.id, change.size);
      return null;
    case "collapse":
      setCollapsed(canvas, change.id, change.collapsed);
      return null;
    case "restore":
      restore(canvas, change.nodes, change.edges);
      return null;
    case "unlink": {
      const gone = new Set(change.ids);
      canvas.edges = canvas.edges.filter((e) => !gone.has(String(e.id)));
      forgetDrawn(canvas, gone);
      return null;
    }
    case "shape":
      return addShape(canvas, change.shape, change.text, { ...position(change.x, change.y), ...size(change.width, change.height) });
    case "reshape":
      reshape(canvas, change.id, change.shape);
      return null;
    case "draw": {
      const color = change.color === undefined ? undefined : colour(change.color);
      return addDrawing(canvas, change.points, change.size, color, { ...position(change.x, change.y), ...size(change.width, change.height) });
    }
    case "line":
      styleLine(canvas, change.id, change.line, change.dash);
      return null;
    case "source":
      setSource(canvas, change.source ?? null);
      return null;
  }
}
