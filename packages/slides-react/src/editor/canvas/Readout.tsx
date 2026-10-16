import { type Rect, boundsOf } from "@kasten-slides/canvas";
import { type JSX, useEffect, useRef } from "react";

import type { CanvasController, Preview } from "./controller.ts";

/** How far under what is moved, sized or turned its number stands, in pixels. */
const BELOW = 14;

const union = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  return { x: left, y: top, w: Math.max(...rects.map((r) => r.x + r.w)) - left, h: Math.max(...rects.map((r) => r.y + r.h)) - top };
};

/**
 * What a gesture says in numbers, beside what it is doing to the slide: where the box is while it is moved ("x, y"), its size while it is
 * resized, the angle while it is turned. Several boxes say the place and size of the box round them. Nothing for the other gestures.
 */
export function readoutOf(preview: Pick<Preview, "gesture" | "angle" | "overrides">): { text: string; at: Rect } | null {
  const { gesture, angle, overrides } = preview;
  if (gesture !== "resize" && gesture !== "rotate" && gesture !== "move" && gesture !== "grab") return null;
  const boxes = [...overrides.values()];
  const at = union(boxes.map((box) => boundsOf(box)));
  if (!at) return null;
  if (gesture === "rotate") return angle === null ? null : { text: `${Math.round(angle)}°`, at };
  // One box says its own place and size, as it is drawn; several say those of the box round them.
  const own = boxes.length === 1 ? boxes[0] : undefined;
  if (gesture === "move" || gesture === "grab") return { text: `${Math.round(own ? own.x : at.x)}, ${Math.round(own ? own.y : at.y)}`, at };
  return { text: `${Math.round(own ? own.w : at.w)} × ${Math.round(own ? own.h : at.h)}`, at };
}

/**
 * The number beside what a gesture is moving, sizing or turning. Its text changes at every step of the pointer, so it is written straight
 * into one node (made when the gesture begins and taken away when it ends) and React draws nothing for the steps.
 */
export function Readout({ controller, zoom }: { controller: CanvasController; zoom: number }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const scale = useRef(zoom);
  scale.current = zoom;
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let node: HTMLDivElement | null = null;
    const show = (): void => {
      const read = readoutOf(controller.preview);
      if (!read) {
        node?.remove();
        node = null;
        return;
      }
      if (!node) {
        node = root.ownerDocument.createElement("div");
        node.className = "ks-readout";
        root.append(node);
      }
      node.style.left = `${(read.at.x + read.at.w / 2) * scale.current}px`;
      node.style.top = `${(read.at.y + read.at.h) * scale.current + BELOW}px`;
      if (node.textContent !== read.text) node.textContent = read.text;
    };
    show();
    const stop = controller.subscribe(show);
    return () => {
      stop();
      node?.remove();
    };
  }, [controller]);
  return <div ref={host} className="ks-overlay" />;
}
