import type { Item, Rect } from "@kasten-slides/canvas";
import { type JSX, useRef } from "react";

import { Icon } from "../ui/Icon.tsx";
import type { Preview } from "./controller.ts";
import { moveHandles, onScreen, placeMoveHandle } from "./move-handle.ts";
import { useVisibleArea } from "./visible-area.ts";

interface MoveHandlesProps {
  /** Pixels on screen per slide unit. */
  zoom: number;
  /** The selected blocks, with any preview position applied. */
  selected: readonly Item[];
  /** The box round several selected blocks. */
  group: Rect | null;
  hovered: Item | null;
  gesture: Preview["gesture"];
  /** The select tool is in hand. */
  active: boolean;
}

/**
 * The move handles, drawn over the slide and never in it: one on what is selected and a lighter one on the block the
 * pointer is over. Pressing one is what the canvas reads (`data-move`) as the start of a move. The press must not take
 * the focus, or a text box being edited would close; `data-ks-keep-focus` and the cancelled mouse-down say so to the browser
 * and to the text editor.
 */
export function MoveHandles({ zoom, selected, group, hovered, gesture, active }: MoveHandlesProps): JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const area = useVisibleArea(layer, zoom);
  const handles = moveHandles({ selected, group, hovered, gesture, active });
  return (
    <div ref={layer} className="ks-move-layer">
      {handles.map((handle) => {
        const place = placeMoveHandle({ box: onScreen(handle.box, zoom), rotation: handle.rotation, area });
        const dragging = handle.kind === "selection" && gesture === "grab";
        return (
          <span
            key={handle.id ?? "selection"}
            className={`ks-move is-${handle.kind}${place.inside ? " is-inside" : ""}${dragging ? " is-dragging" : ""}`}
            style={{ left: place.x, top: place.y }}
            data-move={handle.id ?? ""}
            data-chrome={handle.kind === "selection" ? "" : undefined}
            data-ks-keep-focus=""
            aria-label="Move"
            title="Drag to move (arrow keys nudge)"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Icon name="move" size={14} />
          </span>
        );
      })}
    </div>
  );
}
