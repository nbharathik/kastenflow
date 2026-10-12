// Pieces every node on a board shares: a handle on each side to drag
// connections from, and resize handles while it is selected.

import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import { useBoard, useBoardState } from "../context";
import type { FlowNode } from "../model/flow";

export type BoardNodeProps = NodeProps<FlowNode>;

/** Nodes draw again only when what they show changes, not as they move. */
export const sameNode = (a: BoardNodeProps, b: BoardNodeProps) => a.data === b.data && a.selected === b.selected && a.width === b.width && a.height === b.height;

const SIDES = [
  [Position.Top, "top"],
  [Position.Right, "right"],
  [Position.Bottom, "bottom"],
  [Position.Left, "left"],
] as const;

/** Where each side's middle is, for React Flow: it reads handle positions
 * from elements with class `source` when a node appears or changes size.
 * Invisible and zero-sized, with no store behind them, so every node can
 * have them; first in the node, so their positions are the ones used. */
const ANCHORS = (
  <>
    {SIDES.map(([, side]) => (
      <i key={side} className={`source kasten-anchor is-${side}`} data-handleid={side} data-handlepos={side} aria-hidden="true" />
    ))}
  </>
);

/** Drag from a side to connect; connections keep the sides dragged between.
 * Only the node under the pointer and the one a connection starts from have
 * handles to grab (a chosen node shows its resize handles instead): each
 * follows React Flow's store, and 2,000 of them would cost every frame of
 * a drag. */
export const SideHandles = memo(function SideHandles({ id }: { id: string }) {
  const near = useBoardState((s) => s.hovered === id || s.linking === id);
  return (
    <>
      {ANCHORS}
      {near &&
        SIDES.map(([position, side]) => <Handle key={side} type="source" position={position} id={side} className="kasten-side-handle" aria-label={`Connect from the ${side}`} />)}
    </>
  );
});

interface ResizerProps {
  id: string;
  minWidth?: number;
  minHeight?: number;
  /** Only the width changes (title-only cards). */
  widthOnly?: boolean;
}

/** Resize handles on a node selected on its own; letting go is one batch. */
export function Resizer({ id, minWidth = 80, minHeight = 40, widthOnly = false }: ResizerProps) {
  const board = useBoard();
  const multi = useBoardState((s) => s.multi);
  if (multi) return null;
  return (
    <NodeResizer
      minWidth={minWidth}
      minHeight={minHeight}
      maxHeight={widthOnly ? minHeight : undefined}
      handleClassName="kasten-resize-handle"
      lineClassName="kasten-resize-line"
      onResizeStart={() => board.store.setState({ moving: true, menu: null })}
      onResizeEnd={(_, box) => board.resizeEnd(id, box)}
    />
  );
}
