// Where a browser tab's native view goes. The view is laid over a placeholder
// in the page, so what is needed is the placeholder's rectangle in the physical
// pixels of the window. The window's page is laid out in CSS pixels, scaled by
// `devicePixelRatio`, which already includes the display's scale and the app's
// zoom (lib/zoom.ts sets the page's zoom factor), so one multiplication does
// both. The page fills the window's client area from its corner, so viewport
// coordinates are the window's.

import type { Bounds } from "./types";

/** A rectangle in CSS pixels, as `getBoundingClientRect` gives one. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The most the native side takes, as it clamps too. */
const LIMIT = 32_768;

/** `box` in physical pixels at `ratio` physical pixels to a CSS pixel. The
 * edges are rounded, not the size, so two views side by side never overlap or
 * leave a seam; the view is never empty. */
export function toPhysical(box: Box, ratio: number): Bounds {
  const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const clamp = (n: number) => Math.max(-LIMIT, Math.min(LIMIT, n));
  const x = clamp(Math.round(box.left * scale));
  const y = clamp(Math.round(box.top * scale));
  const right = clamp(Math.round(box.right * scale));
  const bottom = clamp(Math.round(box.bottom * scale));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export const sameBounds = (a: Bounds | null, b: Bounds | null): boolean => a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Whether a rectangle has no area, such as an element that is not shown. */
export const isEmpty = (box: Box): boolean => !(box.right - box.left > 0 && box.bottom - box.top > 0);

/** Whether two rectangles share any area. */
export const overlaps = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** A DOM rectangle as a box. */
export const boxOf = (rect: { left: number; top: number; right: number; bottom: number }): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
