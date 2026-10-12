// What a drag does to an element, as the browser can show it without drawing the element again:
// a move is a translation, a turn is a rotation about the middle, a resize is a stretch about
// the middle. The sums are here, free of the page, so they are tested with plain numbers.

import type { Placement } from "../session/elements.ts";

/** Where an element is before the drag touches it. */
export interface Base {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

/** What the drag has done to an element since it began, in slide units and degrees. */
export type Look =
  | { kind: "none" }
  /** Slid by (`dx`, `dy`). */
  | { kind: "move"; dx: number; dy: number }
  /** Turned by `degrees` about its middle, whose own move is (`dx`, `dy`). */
  | { kind: "turn"; dx: number; dy: number; degrees: number }
  /** Stretched about its middle by `sx` and `sy` (negative when the drag mirrored it), whose own move is (`dx`, `dy`). */
  | { kind: "size"; dx: number; dy: number; sx: number; sy: number };

const SAME = 1e-6;
const same = (a: number, b: number): boolean => Math.abs(a - b) < SAME;

/** How the element was before: its box with the turn and the flips it has. */
export function baseOf(box: { x: number; y: number; w: number; h: number }, element: { rotation?: number | null; flipH?: boolean; flipV?: boolean }): Base {
  return { x: box.x, y: box.y, w: box.w, h: box.h, rotation: element.rotation ?? 0, flipH: element.flipH ?? false, flipV: element.flipV ?? false };
}

/** What the drag has done to an element, given where it began and where the drag has put it. */
export function lookOf(base: Base, to: Placement): Look {
  const dx = to.x + to.w / 2 - (base.x + base.w / 2);
  const dy = to.y + to.h / 2 - (base.y + base.h / 2);
  const resized = !same(base.w, to.w) || !same(base.h, to.h);
  const mirroredH = (to.flipH ?? base.flipH) !== base.flipH;
  const mirroredV = (to.flipV ?? base.flipV) !== base.flipV;
  const degrees = (to.rotation ?? base.rotation) - base.rotation;
  if (resized || mirroredH || mirroredV) {
    // A side with no length (a straight line) has nothing to stretch.
    const sx = base.w > SAME ? to.w / base.w : 1;
    const sy = base.h > SAME ? to.h / base.h : 1;
    return { kind: "size", dx, dy, sx: mirroredH ? -sx : sx, sy: mirroredV ? -sy : sy };
  }
  if (!same(degrees, 0)) return { kind: "turn", dx, dy, degrees };
  if (same(dx, 0) && same(dy, 0)) return { kind: "none" };
  return { kind: "move", dx, dy };
}

/** The look as the `translate`, `rotate` and `scale` properties say it; empty text for the ones that stay as they are. */
export function cssOf(look: Look): { translate: string; rotate: string; scale: string } {
  switch (look.kind) {
    case "move":
      return { translate: `${look.dx}px ${look.dy}px`, rotate: "", scale: "" };
    case "turn":
      return { translate: `${look.dx}px ${look.dy}px`, rotate: `${look.degrees}deg`, scale: "" };
    case "size":
      return { translate: `${look.dx}px ${look.dy}px`, rotate: "", scale: `${look.sx} ${look.sy}` };
    default:
      return { translate: "", rotate: "", scale: "" };
  }
}

/** The elements whose resize is drawn exactly, by drawing them again; more than this are stretched, which costs nothing per element. */
export const EXACT_LIMIT = 12;

/** How a resized element is shown: drawn again at its new size (`exact`), or stretched from how it was (`stretch`). */
export function sizingOf(count: number, base: Base, to: Placement, group: boolean): "exact" | "stretch" {
  if (group) return "stretch";
  if (count <= EXACT_LIMIT) return "exact";
  // A stretch is about the middle along the screen's axes, which is the element's own only when it is not turned.
  return base.rotation === 0 && (to.rotation ?? 0) === 0 ? "stretch" : "exact";
}

/** The most elements of one selection that get an outline each; with more, only the box round them is drawn. */
export const OUTLINE_LIMIT = 24;
