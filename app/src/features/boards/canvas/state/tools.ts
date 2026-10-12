// What a pointer does on the board: select and move (the
// default), pan by hand, draw, erase drawings, place a shape, or join
// things with a connection (dragging from a side's dot, nothing moves).

import type { ShapeKind } from "../../../../lib/vault/types";
import type { BoardController } from "./controller";
import { select } from "./store";

export type Tool = "select" | "hand" | "draw" | "erase" | "connect" | `shape:${ShapeKind}`;

export function setTool(board: BoardController, tool: Tool): void {
  const { nodes, edges } = board.store.getState();
  board.store.setState({ tool, menu: null, editing: null });
  // As in tldraw, drawing, erasing or placing a shape starts with nothing
  // selected, so no selection's bar sits over the work.
  const marks = tool !== "select" && tool !== "hand";
  if (marks && (nodes.some((n) => n.selected) || edges.some((e) => e.selected))) select(board.store, []);
}

/** The shape a tool places, if it places one. */
export const shapeOfTool = (tool: Tool): ShapeKind | null => (tool.startsWith("shape:") ? (tool.slice(6) as ShapeKind) : null);
