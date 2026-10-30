// Dragging the gutter between two columns to set their widths. The widths
// follow the pointer on the page at once; letting go writes the ratio in one
// step (one Undo), and Escape puts the old widths back.

import { MIN_SHARE } from "./serialize";

const sum = (parts: readonly number[]) => parts.reduce((a, b) => a + b, 0);

/** The widths as whole percentages adding up to 100. */
export function asPercent(parts: readonly number[]): number[] {
  const total = sum(parts);
  const pct = parts.map((p) => Math.round((p / total) * 100));
  pct[pct.length - 1] = 100 - sum(pct.slice(0, -1));
  return pct;
}

/**
 * The widths after the gutter after column `cut` (0 is the first) moves by
 * `delta` percent of the whole: the column before grows and the one after
 * shrinks by as much, and neither goes under MIN_SHARE. Whole percentages.
 */
export function ratioAfterDrag(parts: readonly number[], cut: number, delta: number): number[] {
  const total = sum(parts);
  const pct = parts.map((p) => (p / total) * 100);
  const before = pct[cut];
  const after = pct[cut + 1];
  if (before === undefined || after === undefined) return asPercent(parts);
  const moved = Math.min(Math.max(delta, MIN_SHARE - before), after - MIN_SHARE);
  const next = [...pct];
  next[cut] = Math.round(before + moved);
  next[cut + 1] = after - moved;
  // Every other column rounds on its own; the one after the gutter takes what is left of 100.
  const others = next.map((p, i) => (i === cut + 1 ? 0 : Math.round(p)));
  next[cut + 1] = 100 - sum(others);
  return next.map((p, i) => (i === cut + 1 ? p : others[i]!));
}

export interface GutterDrag {
  /** The columns' widths when the drag began. */
  start: readonly number[];
  /** Which gutter: after column `cut`. */
  cut: number;
  /** The width the percentages are shares of, in pixels (the columns' room without their gaps). */
  room: number;
  /** The widths as the pointer has them now (live, not yet written). */
  onMove(parts: number[]): void;
  /** Let go: write these widths. */
  onDrop(parts: number[]): void;
  /** Escape or a lost pointer: put the old widths back. */
  onCancel(): void;
}

/** Follows a pointer pressed on a gutter. Returns what ends the drag early, quietly. */
export function dragGutter(event: PointerEvent, gutter: HTMLElement, drag: GutterDrag): () => void {
  const pointer = event.pointerId;
  const x0 = event.clientX;
  let latest = [...drag.start];
  let done = false;

  const partsAt = (x: number) => ratioAfterDrag(drag.start, drag.cut, ((x - x0) / Math.max(drag.room, 1)) * 100);
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    latest = partsAt(e.clientX);
    drag.onMove(latest);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    latest = partsAt(e.clientX);
    finish(true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };

  function finish(drop: boolean, quiet = false): void {
    if (done) return;
    done = true;
    gutter.removeEventListener("pointermove", onMove);
    gutter.removeEventListener("pointerup", onUp);
    gutter.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    if (gutter.hasPointerCapture?.(pointer)) gutter.releasePointerCapture(pointer);
    if (quiet) return;
    if (drop) drag.onDrop(latest);
    else drag.onCancel();
  }
  const onCancel = () => finish(false);

  gutter.setPointerCapture?.(pointer);
  gutter.addEventListener("pointermove", onMove);
  gutter.addEventListener("pointerup", onUp);
  gutter.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
  return () => finish(false, true);
}
