// The browser preview's tag schemas, properties, sections and boards: the
// same results as the core's, on the preview's stored files.

import type { BoardAdded, BoardEdge, BoardNode, BoardView, NoteMeta, TagSchema } from "../../../lib/vault/types";
import { dashed, drawingOf, lineOf, shapeOf } from "./board-drawing";
import { cardSizeOf, isCollapsed, sourceOf } from "./board-extras";
import { readBlock, readFlow, writeFlow, type Flow } from "../../../lib/flow-yaml";

/** Reads `tags/<name>.yaml` as the core does, leniently. */
export function parseSchema(path: string, yaml: string): TagSchema {
  const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.yaml$/, "");
  const top = (key: string) => {
    const line = yaml.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    return line ? readFlow(line.slice(key.length + 1)) : null;
  };
  const list = (key: string): Flow[] => {
    const lines = yaml.split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at < 0) return [];
    const inline = lines[at]!.slice(key.length + 1).trim();
    if (inline.startsWith("[")) return readFlow(inline) as Flow[];
    const out: Flow[] = [];
    for (const line of lines.slice(at + 1)) {
      const m = /^\s+-\s+(.*)$/.exec(line);
      if (!m) break;
      out.push(readFlow(m[1]!));
    }
    return out;
  };
  const properties = list("properties")
    .filter((p): p is Record<string, Flow> => p !== null && typeof p === "object" && !Array.isArray(p) && p.key != null)
    .map((p) => ({
      key: String(p.key),
      type: p.type == null ? "text" : String(p.type),
      options: Array.isArray(p.options) ? p.options.map(String) : [],
    }));
  const name = top("name");
  const color = top("color");
  return {
    name: name == null ? stem : String(name),
    color: color == null ? null : String(color),
    properties,
    views: list("views").filter((v) => v && typeof v === "object" && !Array.isArray(v)) as Record<string, unknown>[],
    path,
  };
}

/** A note's properties from its frontmatter's `props:` mapping. */
export function propsOf(yaml: string): Record<string, unknown> {
  return readBlock(yaml, "props") ?? {};
}

/** The `props:` block for these values, or null to remove it. */
export function propsBlock(props: Record<string, unknown>, eol: string): string | null {
  const entries = Object.entries(props).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${eol}  ${writeFlow(k)}: ${writeFlow(v)}`).join("");
}

/** The section under `heading`: its heading's line and the line where the
 * next heading of its level or above starts (none at the end). */
function sectionOf(lines: string[], heading: string): { line: number; end: number | undefined } {
  const wanted = heading.trim().replace(/^#+/, "").trim().toLowerCase();
  let fence = false;
  const heads: { line: number; level: number; text: string }[] = [];
  lines.forEach((line, i) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line.replace(/\r?\n$/, ""));
    if (m) heads.push({ line: i, level: m[1]!.length, text: m[2]!.replace(/\*\*|__|~~|`/g, "").trim() });
  });
  const at = heads.findIndex((h) => h.text.toLowerCase() === wanted);
  if (at < 0) throw new Error(`No heading “${heading.trim()}” in this note`);
  return { line: heads[at]!.line, end: heads.slice(at + 1).find((h) => h.level <= heads[at]!.level)?.line };
}

/** An item of a bullet or numbered list, a to-do too (sections.rs). */
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)]) /;

/** The body with `text` added at its end, or at the end of the section
 * under `heading` before its trailing blank lines (sections.rs). */
export function appendUnder(body: string, text: string, heading: string | null): string {
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const added = text.replace(/[\r\n]+$/, "");
  if (heading === null) {
    const base = body.replace(/[\r\n]+$/, "");
    // A list item after a list continues it.
    const sameList = LIST_ITEM.test(base.slice(base.lastIndexOf("\n") + 1)) && LIST_ITEM.test(added.split(/\r?\n/)[0]!);
    return `${base}${eol}${base && !sameList ? eol : ""}${added}${eol}`.replace(/^[\r\n]+/, "");
  }
  const lines = body.split(/(?<=\n)/).filter((line) => line !== "");
  const { line, end } = sectionOf(lines, heading);
  let spot = end ?? lines.length;
  while (spot > line + 1 && !lines[spot - 1]!.trim()) spot--;
  let out = lines.slice(0, spot).join("");
  if (spot > 0 && !lines[spot - 1]!.endsWith("\n")) out += eol;
  return out + added + eol + lines.slice(spot).join("");
}

/** The body with the section under `heading` replaced (sections.rs). */
export function replaceSection(body: string, heading: string, markdown: string): string {
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/(?<=\n)/);
  const { line, end } = sectionOf(lines, heading);
  let out = lines.slice(0, line + 1).join("");
  if (!out.endsWith("\n")) out += eol;
  const text = markdown.replace(/^[\r\n]+|[\r\n]+$/g, "");
  if (text) out += eol + text.replace(/\r?\n/g, eol) + eol;
  if (end !== undefined) out += eol + lines.slice(end).join("");
  return out;
}

export interface Canvas {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  [key: string]: unknown;
}

export function readCanvas(text: string): Canvas {
  const doc = JSON.parse(text || "{}") as Canvas;
  return { ...doc, nodes: Array.isArray(doc.nodes) ? doc.nodes : [], edges: Array.isArray(doc.edges) ? doc.edges : [] };
}

/** The core's house style: one node or edge per line. */
export function writeCanvas(canvas: Canvas): string {
  const lines = ["{"];
  const keys = Object.keys(canvas);
  keys.forEach((key, i) => {
    const comma = i < keys.length - 1 ? "," : "";
    const value = canvas[key];
    if ((key === "nodes" || key === "edges") && Array.isArray(value)) {
      if (value.length === 0) lines.push(`  "${key}": []${comma}`);
      else lines.push(`  "${key}": [`, ...value.map((v, j) => `    ${JSON.stringify(v)}${j < value.length - 1 ? "," : ""}`), `  ]${comma}`);
    } else lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
  });
  lines.push("}");
  return lines.join("\n") + "\n";
}

let counter = 0;
export function newNodeId(canvas: Canvas): string {
  for (;;) {
    const id = ((Date.now() * 1000 + counter++) % 2 ** 52).toString(16).padStart(16, "0").slice(-16);
    if (!canvas.nodes.some((n) => n.id === id) && !canvas.edges.some((e) => e.id === id)) return id;
  }
}

export function boardTitle(path: string, canvas: Canvas): string {
  const extras = canvas["x-kasten"] as { title?: string } | undefined;
  return extras?.title ?? path.slice(path.lastIndexOf("/") + 1).replace(/\.canvas$/, "");
}

/** The board as the core's `BoardView` shows it. `otherTitle` names files
 * that are not notes, such as nested boards. */
export function viewBoard(path: string, canvas: Canvas, notes: NoteMeta[], otherTitle: (file: string) => string | undefined = () => undefined): BoardView {
  const byPath = new Map(notes.map((n) => [n.path, n.title]));
  const text = (item: Record<string, unknown>, key: string) => {
    const value = item[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  const nodes: BoardNode[] = canvas.nodes.map((n) => {
    const node: BoardNode = { id: String(n.id), kind: String(n.type), x: Number(n.x) || 0, y: Number(n.y) || 0, width: Number(n.width) || 0, height: Number(n.height) || 0 };
    if (n.type === "file") {
      node.file = String(n.file);
      const title = byPath.get(node.file) ?? (node.file.endsWith(".md") ? undefined : otherTitle(node.file));
      if (title) node.title = title;
      else node.missing = true;
    }
    if (n.type === "text") node.text = String(n.text ?? "");
    if (n.type === "link") node.url = String(n.url ?? "");
    if (n.type === "group" && n.label != null) node.label = String(n.label);
    if (typeof n.color === "string") node.color = n.color;
    const size = n.type === "file" ? cardSizeOf(canvas, node.id) : undefined;
    if (size) node.size = size;
    if (n.type === "group" && isCollapsed(canvas, node.id)) node.collapsed = true;
    if (n.type === "text") {
      const shape = shapeOf(canvas, node.id);
      if (shape) node.shape = shape;
      const draw = drawingOf(canvas, node.id);
      if (draw) node.draw = draw;
    }
    return node;
  });
  const edges = canvas.edges.map((e) => {
    const edge: BoardEdge = { id: String(e.id), from: String(e.fromNode), to: String(e.toNode) };
    for (const key of ["label", "color", "fromSide", "toSide", "fromEnd", "toEnd"] as const) {
      const value = text(e, key);
      if (value !== undefined) (edge as unknown as Record<string, string>)[key] = value;
    }
    const line = lineOf(canvas, edge.id);
    if (line) edge.line = line;
    if (dashed(canvas, edge.id)) edge.dash = true;
    return edge;
  });
  const source = sourceOf(canvas);
  return { path, title: boardTitle(path, canvas), nodes, edges, ...(source ? { source } : {}) };
}

/** Where content added below a board starts: 80 px under its lowest node,
 * in line with its leftmost one; [0, 0] on an empty board (the core's
 * `geometry::below`). */
export function below(canvas: Canvas): [number, number] {
  const bottom = canvas.nodes.reduce((y, n) => Math.max(y, (Number(n.y) || 0) + (Number(n.height) || 0)), Number.NEGATIVE_INFINITY);
  const left = canvas.nodes.reduce((x, n) => Math.min(x, Number(n.x) || 0), Number.POSITIVE_INFINITY);
  return Number.isFinite(bottom) ? [left, bottom + 80] : [0, 0];
}

/** Cards for `paths` in rows of four from `origin`, by default below
 * everything; files already on the board keep their cards. */
export function addFiles(canvas: Canvas, paths: string[], origin: [number, number] = below(canvas)): BoardAdded {
  const added: BoardAdded = { nodes: [], created: [], groups: [] };
  const [x0, top] = origin;
  let slot = 0;
  for (const path of paths) {
    const existing = canvas.nodes.find((n) => n.type === "file" && n.file === path);
    if (existing) {
      added.nodes.push(String(existing.id));
      continue;
    }
    const id = newNodeId(canvas);
    canvas.nodes.push({ id, type: "file", file: path, x: x0 + (slot % 4) * 360, y: top + Math.floor(slot / 4) * 220, width: 320, height: 180 });
    slot++;
    added.nodes.push(id);
    added.created.push(id);
  }
  return added;
}

export function addSticky(canvas: Canvas, text: string, at?: [number, number]): string {
  const id = newNodeId(canvas);
  const bottom = canvas.nodes.reduce((y, n) => Math.max(y, (Number(n.y) || 0) + (Number(n.height) || 0)), -80);
  const [x, y] = at ?? [0, bottom + 80];
  canvas.nodes.push({ id, type: "text", text, x, y, width: 260, height: 120 });
  return id;
}

/** A node's id from an id, file path or title. */
export function findNode(view: BoardView, ref: string): string {
  const r = ref.trim().toLowerCase();
  const node =
    view.nodes.find((n) => n.id === ref.trim()) ??
    view.nodes.find((n) => n.file === ref.trim()) ??
    view.nodes.find((n) => [n.title, n.label, n.text, n.url].some((v) => v?.trim().toLowerCase() === r));
  if (!node) throw new Error(`No node “${ref}” on this board`);
  return node.id;
}

export function group(canvas: Canvas, ids: string[], label: string): string {
  const members = canvas.nodes.filter((n) => ids.includes(String(n.id)));
  if (members.length === 0) throw new Error("Name at least one node to group");
  const x = Math.min(...members.map((n) => Number(n.x) || 0)) - 40;
  const y = Math.min(...members.map((n) => Number(n.y) || 0)) - 80;
  const right = Math.max(...members.map((n) => (Number(n.x) || 0) + (Number(n.width) || 0))) + 40;
  const bottom = Math.max(...members.map((n) => (Number(n.y) || 0) + (Number(n.height) || 0))) + 40;
  const id = newNodeId(canvas);
  const first = Math.min(...members.map((m) => canvas.nodes.indexOf(m)));
  canvas.nodes.splice(first, 0, { id, type: "group", ...(label.trim() ? { label: label.trim() } : {}), x, y, width: right - x, height: bottom - y });
  return id;
}
