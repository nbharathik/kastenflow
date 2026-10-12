// A shape: a draw.io-style outline with a label in its middle,
// connectable from each side like any node. Double-click or Enter writes
// the label.

import { memo } from "react";

import { tint } from "../colors";
import { useBoard, useBoardState } from "../context";
import { setText } from "../state/gestures";
import { StickyEditor } from "./editors";
import { outlinePath } from "./outlines";
import { Resizer, SideHandles, sameNode, type BoardNodeProps } from "./parts";
import { StickyText } from "./sticky-text";

export const ShapeNode = memo(function ShapeNode({ id, data, selected, width, height }: BoardNodeProps) {
  const board = useBoard();
  const node = data.node;
  const editing = useBoardState((s) => s.editing === id);
  const shape = node.shape ?? "rect";
  const w = width ?? node.width;
  const h = height ?? node.height;
  return (
    <div className={`kasten-node kasten-shape is-${shape}${node.color ? " is-tinted" : ""}`} style={tint(node.color)}>
      <svg className="kasten-shape-outline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <path d={outlinePath(shape, w, h, 1.5)} />
      </svg>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={40} minHeight={30} />}
      <div className="kasten-shape-label">
        {editing ? <StickyEditor text={node.text ?? ""} onDone={(text) => setText(board, id, text)} /> : node.text?.trim() ? <StickyText text={node.text} /> : null}
      </div>
    </div>
  );
}, sameNode);
