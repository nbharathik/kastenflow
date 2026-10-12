// A batch of board changes applied in the window, as the core applies it
// (crates/kasten-core/src/board/change.rs), so a gesture shows at once
// while its batch is on its way. Nothing is mutated: changed nodes and edges
// are new objects and the rest keep their identity, so the canvas redraws
// only what changed.
//
// Changes that make something need the id the core gave it (`made`); with
// no id yet they are skipped, and the thing appears when the core answers.

import type { BoardChange, BoardEdge, BoardNode, BoardView } from "../../../../lib/vault/types";
import { CARD, STICKY, bounds, facingSides, rectOf, sectionAround } from "./geometry";
import { edgeFromRaw, nodeFromRaw } from "./raw";

export type BoardDoc = BoardView;

/** Whether a change makes something, and so has an id in `made`. */
export const makes = (change: BoardChange): boolean =>
  change.kind === "sticky" ||
  change.kind === "card" ||
  change.kind === "link" ||
  change.kind === "section" ||
  change.kind === "wrap" ||
  change.kind === "connect" ||
  change.kind === "shape" ||
  change.kind === "draw";

/** The ids each change that makes something made, by index in `changes`. */
export function madeByIndex(changes: readonly BoardChange[], made: readonly string[] | undefined): (string | undefined)[] {
  let next = 0;
  return changes.map((change) => (makes(change) ? made?.[next++] : undefined));
}

/** Applies `changes` in order. `made` lists the ids the core gave what
 * they make; without it those changes are skipped. */
export function applyChanges(doc: BoardDoc, changes: readonly BoardChange[], made?: readonly string[]): BoardDoc {
  const ids = madeByIndex(changes, made);
  return changes.reduce((current, change, i) => applyChange(current, change, ids[i]), doc);
}

function withNodes(doc: BoardDoc, nodes: BoardNode[]): BoardDoc {
  return { ...doc, nodes };
}

/** `doc` with node `id` changed by `change`; unchanged when it is not there. */
function editNode(doc: BoardDoc, id: string, change: (node: BoardNode) => BoardNode): BoardDoc {
  const at = doc.nodes.findIndex((n) => n.id === id);
  if (at < 0) return doc;
  const nodes = doc.nodes.slice();
  nodes[at] = change(nodes[at]!);
  return withNodes(doc, nodes);
}

function editEdge(doc: BoardDoc, id: string, change: (edge: BoardEdge) => BoardEdge): BoardDoc {
  const at = doc.edges.findIndex((e) => e.id === id);
  if (at < 0) return doc;
  const edges = doc.edges.slice();
  edges[at] = change(edges[at]!);
  return { ...doc, edges };
}

/** `item` with `key` set to `value`, or without it when `value` is empty. */
function setOrClear<T extends object>(item: T, key: keyof T & string, value: string | undefined | null): T {
  const out = { ...item } as Record<string, unknown>;
  if (value) out[key] = value;
  else delete out[key];
  return out as T;
}

const round = Math.round;

export function applyChange(doc: BoardDoc, change: BoardChange, made?: string): BoardDoc {
  switch (change.kind) {
    case "place":
      return editNode(doc, change.id, (node) => {
        const next = { ...node, x: round(change.x), y: round(change.y) };
        if (change.width !== undefined) next.width = round(change.width);
        if (change.height !== undefined) next.height = round(change.height);
        return next;
      });
    case "remove": {
      const gone = new Set(change.ids);
      if (!doc.nodes.some((n) => gone.has(n.id))) return doc;
      return {
        ...doc,
        nodes: doc.nodes.filter((n) => !gone.has(n.id)),
        edges: doc.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
      };
    }
    case "text":
      return editNode(doc, change.id, (node) => {
        if (node.kind === "text") return { ...node, text: change.text };
        if (node.kind === "group") return setOrClear(node, "label", change.text.trim());
        if (node.kind === "link") return { ...node, url: change.text.trim() };
        return node;
      });
    case "color": {
      let out = doc;
      for (const id of change.ids) {
        const paint = <T extends BoardNode | BoardEdge>(item: T) => setOrClear(item, "color", change.color?.trim());
        out = out.nodes.some((n) => n.id === id) ? editNode(out, id, paint) : editEdge(out, id, paint);
      }
      return out;
    }
    case "sticky":
      if (!made) return doc;
      return withNodes(doc, [...doc.nodes, { id: made, kind: "text", text: change.text, x: round(change.x), y: round(change.y), ...STICKY }]);
    case "card": {
      const path = change.path.trim();
      if (!made || doc.nodes.some((n) => n.kind === "file" && n.file === path)) return doc;
      return withNodes(doc, [...doc.nodes, { id: made, kind: "file", file: path, x: round(change.x), y: round(change.y), ...CARD }]);
    }
    case "link":
      if (!made) return doc;
      return withNodes(doc, [...doc.nodes, { id: made, kind: "link", url: change.url.trim(), x: round(change.x), y: round(change.y), ...CARD }]);
    case "section": {
      if (!made) return doc;
      const label = change.label.trim();
      const section: BoardNode = { id: made, kind: "group", x: round(change.x), y: round(change.y), width: round(change.width), height: round(change.height) };
      if (label) section.label = label;
      return withNodes(doc, [section, ...doc.nodes]);
    }
    case "wrap":
      return made ? wrap(doc, change.ids, change.label, made) : doc;
    case "connect":
      return made ? connect(doc, change, made) : doc;
    case "edge":
      return editEdge(doc, change.id, (edge) => {
        let next = edge;
        if (change.label !== undefined) next = setOrClear(next, "label", change.label.trim());
        if (change.color !== undefined) next = setOrClear(next, "color", change.color.trim());
        if (change.fromEnd !== undefined) next = setOrClear(next, "fromEnd", change.fromEnd);
        if (change.toEnd !== undefined) next = setOrClear(next, "toEnd", change.toEnd);
        if (change.fromSide !== undefined) next = setOrClear(next, "fromSide", change.fromSide);
        if (change.toSide !== undefined) next = setOrClear(next, "toSide", change.toSide);
        return next;
      });
    case "unlink": {
      const gone = new Set(change.ids);
      if (!doc.edges.some((e) => gone.has(e.id))) return doc;
      return { ...doc, edges: doc.edges.filter((e) => !gone.has(e.id)) };
    }
    case "card_size":
      return editNode(doc, change.id, (node) => (node.kind === "file" ? setOrClear(node, "size", change.size) : node));
    case "collapse":
      return editNode(doc, change.id, (node) => {
        if (node.kind !== "group") return node;
        const next = { ...node };
        if (change.collapsed) next.collapsed = true;
        else delete next.collapsed;
        return next;
      });
    case "shape": {
      if (!made) return doc;
      const box = { x: round(change.x), y: round(change.y), width: round(change.width), height: round(change.height) };
      return withNodes(doc, [...doc.nodes, { id: made, kind: "text", text: change.text, shape: change.shape, ...box }]);
    }
    case "reshape":
      return editNode(doc, change.id, (node) => (node.kind === "text" ? setOrClear(node, "shape", change.shape) : node));
    case "draw": {
      if (!made) return doc;
      const box = { x: round(change.x), y: round(change.y), width: round(change.width), height: round(change.height) };
      const node: BoardNode = { id: made, kind: "text", text: "", draw: { points: change.points, size: change.size }, ...box };
      if (change.color) node.color = change.color;
      return withNodes(doc, [...doc.nodes, node]);
    }
    case "line":
      return editEdge(doc, change.id, (edge) => {
        let next = change.line === undefined ? edge : setOrClear(edge, "line", change.line);
        if (change.dash !== undefined) {
          next = { ...next };
          if (change.dash) next.dash = true;
          else delete next.dash;
        }
        return next;
      });
    case "source": {
      const next = { ...doc };
      if (change.source) next.source = change.source;
      else delete next.source;
      return next;
    }
    case "restore": {
      const taken = new Set([...doc.nodes, ...doc.edges].map((item) => item.id));
      const fresh = change.nodes.map(nodeFromRaw).filter((n) => !taken.has(n.id));
      const nodes = [...fresh.filter((n) => n.kind === "group").reverse(), ...doc.nodes, ...fresh.filter((n) => n.kind !== "group")];
      const all = new Set(nodes.map((n) => n.id));
      const edges = change.edges.map(edgeFromRaw).filter((e) => !taken.has(e.id) && all.has(e.from) && all.has(e.to));
      return { ...doc, nodes, edges: [...doc.edges, ...edges] };
    }
  }
}

/** A section around nodes, just before the lowest of them (the core's `group`). */
function wrap(doc: BoardDoc, ids: readonly string[], label: string, id: string): BoardDoc {
  const members = doc.nodes.filter((n) => ids.includes(n.id));
  const around = bounds(members.map(rectOf));
  if (!around) return doc;
  const section: BoardNode = { id, kind: "group", ...sectionAround(around) };
  if (label.trim()) section.label = label.trim();
  const first = Math.min(...members.map((m) => doc.nodes.indexOf(m)));
  const nodes = doc.nodes.slice();
  nodes.splice(first, 0, section);
  return withNodes(doc, nodes);
}

function connect(doc: BoardDoc, change: Extract<BoardChange, { kind: "connect" }>, id: string): BoardDoc {
  const from = doc.nodes.find((n) => n.id === change.from);
  const to = doc.nodes.find((n) => n.id === change.to);
  if (!from || !to || doc.edges.some((e) => e.id === id)) return doc;
  const [fromFacing, toFacing] = facingSides(rectOf(from), rectOf(to));
  const edge: BoardEdge = { id, from: change.from, to: change.to, fromSide: change.fromSide ?? fromFacing, toSide: change.toSide ?? toFacing };
  const label = change.label?.trim();
  if (label) edge.label = label;
  return { ...doc, edges: [...doc.edges, edge] };
}
