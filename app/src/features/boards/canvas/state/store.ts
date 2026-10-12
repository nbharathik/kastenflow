// One open board's view state: the board as shown, React Flow's nodes and
// edges made from it (with the selection and any drag in progress), and
// what is being written or asked for. The board itself changes only through
// batches (controller.ts); this store just follows it.

import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange, type XYPosition } from "@xyflow/react";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { BoardDoc } from "../model/apply";
import { Z, resized, toFlowEdges, toFlowNodes, type FlowEdge, type FlowNode } from "../model/flow";
import { carried, hiddenIds } from "../model/sections";
import { savedPen, type Pen } from "./pen";
import type { Tool } from "./tools";

export type MenuTarget = { kind: "nodes"; ids: string[] } | { kind: "edge"; id: string } | { kind: "pane"; at: XYPosition };

export interface Menu {
  /** Where it opens, in window pixels. */
  x: number;
  y: number;
  target: MenuTarget;
}

export interface BoardState {
  doc: BoardDoc;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Nodes folded sections hide. */
  hidden: ReadonlySet<string>;
  /** The sticky, section, link or edge whose text is being written. */
  editing: string | null;
  /** An expanded card whose editor takes the focus once it shows: in its
   * title (a new card) or at the end of its text. */
  focusCard: { id: string; at: "title" | "end" } | null;
  /** More than one node is selected: no resize handles. */
  multi: boolean;
  menu: Menu | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Something is being dragged or resized: toolbars keep out of the way. */
  moving: boolean;
  /** The node under the pointer, and the one a connection is dragged from:
   * they show their side handles. */
  hovered: string | null;
  linking: string | null;
  /** The view is being panned or zoomed: heavy things wait. */
  viewMoving: boolean;
  /** Notes on the board with agent writing not yet edited or accepted. */
  marked: ReadonlySet<string>;
  /** What the pointer does (tools.ts), and the pen it draws with (pen.ts). */
  tool: Tool;
  pen: Pen;
  /** The slide shown while the board is presented (present.ts), else null. */
  presenting: number | null;
  /** Focus mode: the bars are hidden, leaving the canvas (focus.ts). */
  focus: boolean;
}

export type BoardStore = StoreApi<BoardState>;

export function createBoardStore(doc: BoardDoc): BoardStore {
  const hidden = hiddenIds(doc.nodes);
  return createStore<BoardState>()(() => ({
    doc,
    nodes: toFlowNodes(doc, [], hidden),
    edges: toFlowEdges(doc, [], hidden),
    hidden,
    editing: null,
    focusCard: null,
    multi: false,
    menu: null,
    canUndo: false,
    canRedo: false,
    moving: false,
    hovered: null,
    linking: null,
    viewMoving: false,
    marked: new Set(),
    tool: "select",
    pen: savedPen(),
    presenting: null,
    focus: false,
  }));
}

/** Follows a new board: nodes that did not change keep their objects, and
 * nodes under the pointer stay where the drag has them. */
export function showDoc(store: BoardStore, doc: BoardDoc): void {
  const state = store.getState();
  if (state.doc === doc) return;
  const hidden = hiddenIds(doc.nodes);
  const before = new Map(state.nodes.map((n) => [n.id, n]));
  const nodes = toFlowNodes(doc, state.nodes, hidden).map((node) => {
    const old = before.get(node.id);
    return old?.dragging && old !== node ? { ...node, position: old.position, dragging: true } : node;
  });
  const editing = state.editing && (doc.nodes.some((n) => n.id === state.editing) || doc.edges.some((e) => e.id === state.editing)) ? state.editing : null;
  store.setState({ doc, hidden, nodes, edges: toFlowEdges(doc, state.edges, hidden), editing });
}

/** A drag in progress: where each moving node started, and the nodes the
 * dragged sections carry along. */
export interface Drag {
  starts: Map<string, XYPosition>;
  carried: string[];
}

/** Starts a drag of `ids`: sections among them carry what they hold. */
export function startDrag(store: BoardStore, ids: readonly string[]): Drag {
  const { doc, nodes } = store.getState();
  const dragged = new Set(ids);
  const along = carried(doc.nodes, dragged);
  const starts = new Map<string, XYPosition>();
  for (const node of nodes) if (dragged.has(node.id) || along.includes(node.id)) starts.set(node.id, node.position);
  store.setState({ moving: true, menu: null });
  return { starts, carried: along };
}

/** React Flow's node changes: selection, drags and resizes. */
export function nodesChanged(store: BoardStore, changes: NodeChange<FlowNode>[], drag: Drag | null): void {
  let nodes = applyNodeChanges(changes, store.getState().nodes);
  const touched = new Map<string, FlowNode>();
  for (const change of changes) {
    if (change.type === "dimensions" && change.dimensions) {
      const at = nodes.findIndex((n) => n.id === change.id);
      if (at >= 0) touched.set(change.id, resized(nodes[at]!, change.dimensions.width, change.dimensions.height));
    }
    if (change.type === "select") {
      const node = nodes.find((n) => n.id === change.id);
      if (node && node.type !== "section") touched.set(node.id, { ...(touched.get(node.id) ?? node), zIndex: change.selected ? Z.lifted : Z.node });
    }
  }
  if (drag && drag.carried.length) {
    const lead = changes.find((c): c is Extract<NodeChange<FlowNode>, { type: "position" }> => c.type === "position" && Boolean(c.position) && drag.starts.has(c.id));
    const start = lead && drag.starts.get(lead.id);
    if (lead?.position && start) {
      const dx = lead.position.x - start.x;
      const dy = lead.position.y - start.y;
      for (const id of drag.carried) {
        const from = drag.starts.get(id);
        const node = nodes.find((n) => n.id === id);
        if (from && node) touched.set(id, { ...node, position: { x: from.x + dx, y: from.y + dy } });
      }
    }
  }
  if (touched.size) nodes = nodes.map((n) => touched.get(n.id) ?? n);
  const selecting = changes.some((c) => c.type === "select");
  store.setState(selecting ? { nodes, multi: countSelected(nodes) > 1 } : { nodes });
}

function countSelected(nodes: readonly FlowNode[]): number {
  let count = 0;
  for (const node of nodes) if (node.selected && ++count > 1) break;
  return count;
}

export function edgesChanged(store: BoardStore, changes: EdgeChange<FlowEdge>[]): void {
  store.setState({ edges: applyEdgeChanges(changes, store.getState().edges) });
}

/** Selects exactly these nodes and edges. */
export function select(store: BoardStore, nodeIds: Iterable<string>, edgeIds: Iterable<string> = []): void {
  const wanted = new Set(nodeIds);
  const wantedEdges = new Set(edgeIds);
  const { nodes, edges } = store.getState();
  store.setState({
    nodes: nodes.map((n) => (Boolean(n.selected) === wanted.has(n.id) ? n : { ...n, selected: wanted.has(n.id), zIndex: n.type === "section" ? Z.section : wanted.has(n.id) ? Z.lifted : Z.node })),
    edges: edges.map((e) => (Boolean(e.selected) === wantedEdges.has(e.id) ? e : { ...e, selected: wantedEdges.has(e.id) })),
    multi: wanted.size > 1,
  });
}

export const selectedNodes = (state: BoardState) => state.nodes.filter((n) => n.selected);
export const selectedEdges = (state: BoardState) => state.edges.filter((e) => e.selected);
