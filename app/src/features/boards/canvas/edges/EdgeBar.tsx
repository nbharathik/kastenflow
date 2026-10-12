// The small bar of a selected connection: a colour dot, the arrowhead, how
// the line runs, dashes, its label and taking it away. The arrow at the
// start, and the rest, are in its right-click menu. It keeps its size at
// every zoom.

import { EdgeToolbar } from "@xyflow/react";

import type { BoardEdge } from "../../../../lib/vault/types";
import { Icon } from "../../../../ui/Icon";
import { useBoard, useBoardState } from "../context";
import { removeFromBoard, restyleEdge, restyleLine } from "../state/gestures";
import { ColorDot } from "../toolbar/ColorDot";

export function EdgeBar({ id, edge, x, y }: { id: string; edge: BoardEdge; x: number; y: number }) {
  const board = useBoard();
  const moving = useBoardState((s) => s.moving);
  if (moving) return null;
  const endArrow = (edge.toEnd ?? "arrow") === "arrow";
  const line = LINES.find((l) => l.line === (edge.line ?? "curve")) ?? LINES[0];
  const next = LINES[(LINES.indexOf(line) + 1) % LINES.length]!;
  return (
    <EdgeToolbar edgeId={id} x={x} y={y - 22} alignY="bottom" isVisible style={{ zIndex: 20 }}>
      <div className="kasten-toolbar kasten-selbar nodrag nopan" role="toolbar" aria-label="Connection">
        <ColorDot value={edge.color ?? null} onPick={(color) => restyleEdge(board, id, { color: color ?? "" })} />
        <button type="button" aria-pressed={endArrow} title="Arrow at the end" aria-label="Arrow at the end" onClick={() => restyleEdge(board, id, { toEnd: endArrow ? "none" : "" })}>
          <ArrowIcon />
        </button>
        <button type="button" title={`${line.name} (press for ${next.name.toLowerCase()})`} aria-label={line.name} onClick={() => restyleLine(board, id, { line: next.line === "curve" ? "" : next.line })}>
          <LineIcon d={line.d} />
        </button>
        <button type="button" aria-pressed={Boolean(edge.dash)} title="Dashed" aria-label="Dashed" onClick={() => restyleLine(board, id, { dash: !edge.dash })}>
          <LineIcon d="M4 18L20 6" dashed />
        </button>
        <button type="button" title="Label (double-click the connection)" aria-label="Edit label" onClick={() => board.store.setState({ editing: id })}>
          <span className="text-12 font-semibold">Aa</span>
        </button>
        <button type="button" title="Delete connection" aria-label="Delete connection" onClick={() => removeFromBoard(board, [], [id])}>
          <Icon name="trash" className="size-4" />
        </button>
      </div>
    </EdgeToolbar>
  );
}

/** The connection's line: the board's curve, straight, or elbowed as in a
 * flowchart. */
const LINES = [
  { line: "curve", name: "Curved line", d: "M4 18C10 18 14 6 20 6" },
  { line: "straight", name: "Straight line", d: "M4 18L20 6" },
  { line: "elbow", name: "Elbow line", d: "M4 18H12V6H20" },
] as const;

function LineIcon({ d, dashed = false }: { d: string; dashed?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? "3 3" : undefined} className="size-4" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
      <path d="M4 12h15M14 7l5 5-5 5" />
    </svg>
  );
}
