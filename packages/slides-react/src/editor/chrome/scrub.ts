// Dragging across a number to change it, as design tools do: the pointer moves, the number follows.

export interface Scrub {
  /** The value when the drag began. */
  start: number;
  /** How far the pointer has moved sideways since, in pixels. */
  dx: number;
  /** What one step is. */
  step: number;
  /** Shift: ten times as fast. Alt: a tenth as fast. */
  shift?: boolean;
  alt?: boolean;
  min?: number;
  max?: number;
  /** Decimal places kept. */
  decimals?: number;
}

/** How many pixels of movement make one step. */
export const PIXELS_PER_STEP = 4;

/** The number the pointer has dragged to. */
export function scrubbed({ start, dx, step, shift, alt, min, max, decimals = 2 }: Scrub): number {
  const rate = shift ? 10 : alt ? 0.1 : 1;
  const steps = Math.trunc(dx / PIXELS_PER_STEP);
  const raw = start + steps * step * rate;
  const clamped = Math.min(Math.max(raw, min ?? -Infinity), max ?? Infinity);
  const scale = 10 ** decimals;
  return Math.round(clamped * scale) / scale;
}

/** How the arrow and page keys step a number: arrows by one step, Shift ten times as far, Alt a tenth; Page keys ten steps. */
export function keyStep(key: string, step: number, modifiers: { shift?: boolean; alt?: boolean }): number | null {
  const direction = key === "ArrowUp" || key === "PageUp" ? 1 : key === "ArrowDown" || key === "PageDown" ? -1 : 0;
  if (direction === 0) return null;
  const page = key === "PageUp" || key === "PageDown";
  const rate = page || modifiers.shift ? 10 : modifiers.alt ? 0.1 : 1;
  return direction * step * rate;
}
