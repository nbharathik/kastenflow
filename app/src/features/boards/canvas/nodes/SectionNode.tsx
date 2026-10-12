// A section: a soft, lightly tinted frame with its name on a small chip at the
// top left, written in place by a double-click. Dragging the chip (or the
// strip it sits in) carries what is inside; the fold chevron shows when the
// pointer is there, and folding leaves just the chip. Its middle lets clicks
// through to the board, so a box can be dragged there. Its colour is chosen
// from the dot in the bar over it.

import { memo } from "react";

import { Icon } from "../../../../ui/Icon";
import { tint } from "../colors";
import { useBoard, useBoardState } from "../context";
import { contents } from "../model/sections";
import { setText, toggleFold } from "../state/gestures";
import { LineEditor } from "./editors";
import { Resizer, SideHandles, sameNode, type BoardNodeProps } from "./parts";

export const SectionNode = memo(function SectionNode({ id, data, selected }: BoardNodeProps) {
  const board = useBoard();
  const node = data.node;
  const editing = useBoardState((s) => s.editing === id);
  // Counted only while folded, and as a number, so this redraws rarely.
  const inside = useBoardState((s) => (node.collapsed ? contents(s.doc.nodes, node).length : 0));
  const folded = Boolean(node.collapsed);
  return (
    <div className={`kasten-section${folded ? " is-folded" : ""}${node.color ? " is-tinted" : ""}`} style={tint(node.color)}>
      {/* Connection dots only under the pointer: a frame is chosen for its corners. */}
      <SideHandles id={id} />
      {selected && !folded && <Resizer id={id} minWidth={160} minHeight={100} />}
      <div className="kasten-section-bar">
        <div className="kasten-section-chip">
          <button type="button" className="kasten-section-fold nodrag" aria-label={folded ? "Unfold section" : "Fold section"} aria-expanded={!folded} onClick={() => toggleFold(board, id)}>
            <Icon name="chevron" className={`size-3.5 transition-transform ${folded ? "" : "rotate-90"}`} />
          </button>
          {editing ? (
            <LineEditor text={node.label ?? ""} label="Section name" placeholder="Section" onDone={(text) => (text === null ? board.store.setState({ editing: null }) : setText(board, id, text))} />
          ) : (
            <span className="kasten-section-label">{node.label || "Section"}</span>
          )}
          {folded && <span className="kasten-section-count">{inside === 1 ? "1 inside" : `${inside} inside`}</span>}
        </div>
      </div>
    </div>
  );
}, sameNode);
