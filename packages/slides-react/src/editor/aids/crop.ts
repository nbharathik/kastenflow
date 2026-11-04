// Cropping a picture by dragging the edges of its box. The picture keeps its size and place on the slide: dragging an edge inward hides more
// of it, and the box shrinks to what shows. Dragging outward shows more again, back to the whole picture.

import type { Crop } from "@kasten-slides/wasm";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "left" | "top" | "right" | "bottom";

/** The most of a picture a crop may hide across: some of it always shows. */
export const MOST_CUT = 0.95;

export const noCrop = (crop: Crop | null | undefined): Required<Pick<Crop, Side>> => ({ left: crop?.left ?? 0, top: crop?.top ?? 0, right: crop?.right ?? 0, bottom: crop?.bottom ?? 0 });

/** The whole picture, uncropped, in slide units: where it would be if nothing were hidden. */
export function wholePicture(box: Box, crop: Crop | null | undefined): Box {
  const c = noCrop(crop);
  const w = box.w / (1 - c.left - c.right);
  const h = box.h / (1 - c.top - c.bottom);
  return { x: box.x - c.left * w, y: box.y - c.top * h, w, h };
}

const round = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * The box and the crop after the edge `side` is dragged to `at` (a position on the slide, along the axis the edge moves on). The cut is kept
 * between none and what leaves a sliver, and the opposite edge stays where it is.
 */
export function cropEdge(box: Box, crop: Crop | null | undefined, side: Side, at: number): { box: Box; crop: Crop | null } {
  const c = noCrop(crop);
  const whole = wholePicture(box, crop);
  const horizontal = side === "left" || side === "right";
  const start = horizontal ? whole.x : whole.y;
  const size = horizontal ? whole.w : whole.h;
  const opposite = c[side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top"];
  const fromStart = side === "left" || side === "top";
  const wanted = fromStart ? (at - start) / size : (start + size - at) / size;
  const cut = round(Math.min(Math.max(wanted, 0), MOST_CUT - opposite));
  const next = { ...c, [side]: cut };
  const next_box: Box = {
    x: whole.x + next.left * whole.w,
    y: whole.y + next.top * whole.h,
    w: whole.w * (1 - next.left - next.right),
    h: whole.h * (1 - next.top - next.bottom),
  };
  const none = next.left === 0 && next.top === 0 && next.right === 0 && next.bottom === 0;
  return { box: { x: round(next_box.x), y: round(next_box.y), w: round(next_box.w), h: round(next_box.h) }, crop: none ? null : next };
}
