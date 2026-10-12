// A sticky: loose text on the board, in one of the board colours.
// Double-click or Enter writes in it; Tab there grows a mind-map child.

import { memo } from "react";

import { tint } from "../colors";
import { useBoard, useBoardState } from "../context";
import { setText } from "../state/gestures";
import { addChild } from "../state/making";
import { StickyEditor } from "./editors";
import { Resizer, SideHandles, sameNode, type BoardNodeProps } from "./parts";
import { StaleMark, useStale } from "./StaleMark";
import { StickyText } from "./sticky-text";

export const StickyNode = memo(function StickyNode({ id, data, selected }: BoardNodeProps) {
  const board = useBoard();
  const node = data.node;
  const editing = useBoardState((s) => s.editing === id);
  const stale = useStale(id);
  return (
    <div className={`kasten-node kasten-sticky${node.color ? " is-tinted" : ""}${stale ? " is-stale" : ""}`} style={tint(node.color)}>
      <SideHandles id={id} />
      {selected && <Resizer id={id} minWidth={100} minHeight={48} />}
      {editing ? (
        <StickyEditor text={node.text ?? ""} onDone={(text) => setText(board, id, text)} onTab={() => void addChild(board, id)} />
      ) : (
        <StickyText text={node.text ?? ""} />
      )}
      {stale && !editing && <StaleMark id={id} />}
    </div>
  );
}, sameNode);
