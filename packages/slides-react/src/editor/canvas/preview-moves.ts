// A drag that only moves things is shown without drawing them again: the
// canvas slides the elements on the page with the browser's `translate`,
// which needs no layout and no repaint, so a hundred elements move as easily
// as one. Anything else (a resize, a turn) changes what is drawn, and goes
// through the slide as before.

import type { Element, Slide, Theme } from "@kasten-slides/wasm";

import { boxOf } from "../../theme/index.ts";
import type { Placement } from "../session/elements.ts";

export interface Shift {
  dx: number;
  dy: number;
}

const SAME = 1e-6;
const same = (a: number, b: number): boolean => Math.abs(a - b) < SAME;

/** The overrides that are a plain move, as how far each element goes, and the rest. */
export function splitMoves(slide: Slide, theme: Theme, overrides: ReadonlyMap<string, Placement>): { moves: Map<string, Shift>; rest: Map<string, Placement> } {
  const moves = new Map<string, Shift>();
  const rest = new Map<string, Placement>();
  if (overrides.size === 0) return { moves, rest };
  // What is dragged may be inside a group the person went into.
  const byId = new Map<string, Element>();
  const index = (list: readonly Element[]): void => {
    for (const element of list) {
      byId.set(element.id, element);
      if (element.type === "group") index(element.children);
    }
  };
  index(slide.elements);
  for (const [id, to] of overrides) {
    const element = byId.get(id);
    const from = element ? boxOf(theme, slide.layout, element) : null;
    const plain =
      element !== undefined &&
      from !== null &&
      same(from.w, to.w) &&
      same(from.h, to.h) &&
      same(element.rotation ?? 0, to.rotation ?? element.rotation ?? 0) &&
      (to.flipH ?? element.flipH ?? false) === (element.flipH ?? false) &&
      (to.flipV ?? element.flipV ?? false) === (element.flipV ?? false);
    if (plain) moves.set(id, { dx: to.x - from.x, dy: to.y - from.y });
    else rest.set(id, to);
  }
  return { moves, rest };
}
