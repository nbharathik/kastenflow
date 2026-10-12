// Undo for board batches: the changes that take a board back to how it was
// before a batch. A removal comes back with `restore` (ids and all, then its
// card sizes and folds), what a batch made goes with `remove` or `unlink`,
// and every other change is set back to its old value.

import type { BoardChange, BoardNode } from "../../../../lib/vault/types";
import { applyChange, madeByIndex, type BoardDoc } from "./apply";
import { rawEdge, rawNode } from "./raw";

/** The changes that undo `changes`, which turned `before` into a board
 * after the core made `made`. Applied as one batch. */
export function invert(before: BoardDoc, changes: readonly BoardChange[], made: readonly string[]): BoardChange[] {
  const ids = madeByIndex(changes, made);
  const steps: BoardChange[][] = [];
  let doc = before;
  changes.forEach((change, i) => {
    steps.push(inverseOf(doc, change, ids[i]));
    doc = applyChange(doc, change, ids[i]);
  });
  return steps.reverse().flat();
}

/** Puts back nodes as `doc` has them, with their edges, sizes and folds. */
export function restoreNodes(doc: BoardDoc, nodes: readonly BoardNode[]): BoardChange[] {
  if (nodes.length === 0) return [];
  const gone = new Set(nodes.map((n) => n.id));
  const edges = doc.edges.filter((e) => gone.has(e.from) || gone.has(e.to));
  const out: BoardChange[] = [{ kind: "restore", nodes: nodes.map(rawNode), edges: edges.map(rawEdge) }];
  for (const node of nodes) {
    if (node.kind === "file" && node.size) out.push({ kind: "card_size", id: node.id, size: node.size });
    if (node.kind === "group" && node.collapsed) out.push({ kind: "collapse", id: node.id, collapsed: true });
  }
  return out;
}

function inverseOf(doc: BoardDoc, change: BoardChange, made: string | undefined): BoardChange[] {
  const node = (id: string) => doc.nodes.find((n) => n.id === id);
  const isNew = (id: string | undefined) => id !== undefined && !doc.nodes.some((n) => n.id === id) && !doc.edges.some((e) => e.id === id);
  switch (change.kind) {
    case "place": {
      const old = node(change.id);
      if (!old) return [];
      const back: BoardChange = { kind: "place", id: old.id, x: old.x, y: old.y };
      if (change.width !== undefined || change.height !== undefined) Object.assign(back, { width: old.width, height: old.height });
      return [back];
    }
    case "remove":
      return restoreNodes(
        doc,
        doc.nodes.filter((n) => change.ids.includes(n.id)),
      );
    case "text": {
      const old = node(change.id);
      if (!old) return [];
      const text = old.kind === "text" ? (old.text ?? "") : old.kind === "group" ? (old.label ?? "") : old.kind === "link" ? (old.url ?? "") : null;
      return text === null ? [] : [{ kind: "text", id: old.id, text }];
    }
    case "color": {
      // One change per old colour, so each item gets its own back.
      const byColour = new Map<string, string[]>();
      for (const id of change.ids) {
        const item = node(id) ?? doc.edges.find((e) => e.id === id);
        if (!item) continue;
        const key = item.color ?? "";
        byColour.set(key, [...(byColour.get(key) ?? []), id]);
      }
      return [...byColour].map(([color, ids]) => ({ kind: "color", ids, color: color || null }));
    }
    case "sticky":
    case "card":
    case "link":
    case "section":
    case "wrap":
    case "shape":
    case "draw":
      return isNew(made) ? [{ kind: "remove", ids: [made!] }] : [];
    case "reshape": {
      const old = node(change.id);
      return old?.kind === "text" ? [{ kind: "reshape", id: old.id, shape: old.shape ?? "" }] : [];
    }
    case "line": {
      const old = doc.edges.find((e) => e.id === change.id);
      if (!old) return [];
      const back: Extract<BoardChange, { kind: "line" }> = { kind: "line", id: old.id };
      if (change.line !== undefined) back.line = old.line ?? "";
      if (change.dash !== undefined) back.dash = Boolean(old.dash);
      return [back];
    }
    case "connect":
      return isNew(made) ? [{ kind: "unlink", ids: [made!] }] : [];
    case "edge": {
      const old = doc.edges.find((e) => e.id === change.id);
      if (!old) return [];
      const back: Extract<BoardChange, { kind: "edge" }> = { kind: "edge", id: old.id };
      if (change.label !== undefined) back.label = old.label ?? "";
      if (change.color !== undefined) back.color = old.color ?? "";
      if (change.fromEnd !== undefined) back.fromEnd = old.fromEnd ?? "";
      if (change.toEnd !== undefined) back.toEnd = old.toEnd ?? "";
      if (change.fromSide !== undefined) back.fromSide = old.fromSide ?? "";
      if (change.toSide !== undefined) back.toSide = old.toSide ?? "";
      return [back];
    }
    case "unlink": {
      const edges = doc.edges.filter((e) => change.ids.includes(e.id));
      return edges.length ? [{ kind: "restore", nodes: [], edges: edges.map(rawEdge) }] : [];
    }
    case "card_size": {
      const old = node(change.id);
      return old?.kind === "file" ? [{ kind: "card_size", id: old.id, size: old.size ?? null }] : [];
    }
    case "collapse": {
      const old = node(change.id);
      return old?.kind === "group" ? [{ kind: "collapse", id: old.id, collapsed: Boolean(old.collapsed) }] : [];
    }
    case "source":
      return [{ kind: "source", source: doc.source ?? null }];
    case "restore": {
      const nodeIds = change.nodes.map((n) => String(n.id)).filter((id) => !node(id));
      const back = new Set(nodeIds);
      const edgeIds = change.edges
        .filter((e) => !doc.edges.some((d) => d.id === e.id) && !back.has(String(e.fromNode)) && !back.has(String(e.toNode)))
        .map((e) => String(e.id));
      const out: BoardChange[] = [];
      if (edgeIds.length) out.push({ kind: "unlink", ids: edgeIds });
      if (nodeIds.length) out.push({ kind: "remove", ids: nodeIds });
      return out;
    }
  }
}
