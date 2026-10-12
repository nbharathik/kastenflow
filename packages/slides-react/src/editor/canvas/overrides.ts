// The slide as a gesture draws it where the whole slide has to be drawn again, and the box round several things.

import type { Element, Slide, Theme } from "@kasten-slides/wasm";

import type { Placement } from "../session/elements.ts";
import { withFollowing } from "./follow.ts";

/**
 * The slide with the elements a gesture is dragging drawn where the pointer has
 * taken them. `applied` are the ones to change in the slide; `all` (default the
 * same) are every box the drag gives, for the connectors that follow them.
 * Untouched elements stay the same objects, so they are not drawn again.
 */
export function withOverrides(slide: Slide, applied: ReadonlyMap<string, Placement>, theme?: Theme, all: ReadonlyMap<string, Placement> = applied): Slide {
  if (all.size === 0) return slide;
  // What is dragged may be inside a group the person went into: groups are walked, and a group none of whose children changed stays as it was.
  const place = (list: readonly Element[]): Element[] =>
    list.map((element): Element => {
      const box = applied.get(element.id);
      const placed = box ? ({ ...element, ...box } as Element) : element;
      if (placed.type !== "group") return placed;
      const children = place(placed.children);
      return children.some((child, i) => child !== placed.children[i]) ? { ...placed, children } : placed;
    });
  const moved: Slide = applied.size === 0 ? slide : { ...slide, elements: place(slide.elements) };
  // Connectors stay attached to what is being dragged.
  return theme ? withFollowing(moved, theme, all) : moved;
}

/** The upright box that holds all of these boxes, turned as they are. */
export function boundsOfAll(items: readonly { x: number; y: number; w: number; h: number; rotation?: number }[]) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    const turn = ((item.rotation ?? 0) * Math.PI) / 180;
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const hw = (Math.abs(Math.cos(turn)) * item.w + Math.abs(Math.sin(turn)) * item.h) / 2;
    const hh = (Math.abs(Math.sin(turn)) * item.w + Math.abs(Math.cos(turn)) * item.h) / 2;
    left = Math.min(left, cx - hw);
    right = Math.max(right, cx + hw);
    top = Math.min(top, cy - hh);
    bottom = Math.max(bottom, cy + hh);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
