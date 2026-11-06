import { type JSX, type PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { EditorSession } from "../session/session.ts";
import { type Box, type Side, cropEdge } from "./crop.ts";
import { cropMode } from "./crop-mode.ts";
import "./aids.css";

const SIDES: readonly Side[] = ["left", "top", "right", "bottom"];

/**
 * Crop mode for the picture whose id the mode names: a handle on each edge, dragged inward to hide more of the picture and outward to show
 * it again. Enter or Escape (or another selection) finishes. The box and the crop change together, as one step of undo, when a handle is let go.
 */
export function CropLayer({ session, zoom }: { session: EditorSession; zoom: number }): JSX.Element | null {
  const id = useSyncExternalStore(cropMode.subscribe, cropMode.get, cropMode.get);
  const element = id ? session.slide.elements.find((e) => e.id === id) : undefined;
  const [live, setLive] = useState<{ box: Box; side: Side } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const selected = session.state.selection.length === 1 && session.state.selection[0] === id;
  // Leaving the picture (selecting something else, or it going away) ends the mode.
  useEffect(() => {
    if (id && (!element || element.type !== "image" || !selected)) cropMode.set(null);
  }, [id, element, selected]);
  useEffect(() => {
    if (id) root.current?.focus({ preventScroll: true });
  }, [id]);
  if (!id || element?.type !== "image" || element.x == null || element.y == null || element.w == null || element.h == null) return null;
  const box: Box = { x: element.x, y: element.y, w: element.w, h: element.h };

  const at = (event: PointerEvent, side: Side): number => {
    const rect = root.current?.parentElement?.getBoundingClientRect();
    if (!rect) return 0;
    return side === "left" || side === "right" ? (event.clientX - rect.left) / zoom : (event.clientY - rect.top) / zoom;
  };
  const drag = (event: PointerEvent, side: Side): void => {
    if (event.buttons === 0) return;
    setLive({ box: cropEdge(box, element.crop, side, at(event, side)).box, side });
  };
  const drop = (event: PointerEvent, side: Side): void => {
    setLive(null);
    const out = cropEdge(box, element.crop, side, at(event, side));
    session.aids.setCrop(session.slide.id, id, out.box, out.crop);
  };
  const shown = live?.box ?? box;

  return (
    <div
      ref={root}
      className="ks-crop"
      tabIndex={-1}
      role="group"
      aria-label="Crop the picture: drag an edge, Enter or Escape when done"
      data-chrome=""
      style={{ left: shown.x * zoom, top: shown.y * zoom, width: shown.w * zoom, height: shown.h * zoom }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cropMode.set(null);
        }
      }}
    >
      {SIDES.map((side) => (
        <span
          key={side}
          className="ks-crop-handle"
          data-side={side}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => drag(event, side)}
          onPointerUp={(event) => drop(event, side)}
        />
      ))}
    </div>
  );
}
