// How a picture is touched up and shaped: its adjustments as a CSS filter, and a mask of any preset
// shape as a clip path.

import type { Adjust } from "@kasten-slides/wasm";

import { num } from "./format.ts";
import { shapePath } from "./shapes/index.ts";

/**
 * The CSS filter for a picture's adjustments, or undefined when they change nothing. Brightness,
 * contrast and saturation run from -1 to 1 around 0 and become the multiples CSS wants (1 + n);
 * the blur is in slide units, which are CSS pixels.
 */
export function adjustFilter(adjust: Adjust | null | undefined): string | undefined {
  if (!adjust) return undefined;
  const parts: string[] = [];
  const around = (name: string, value: number | null | undefined): void => {
    if (value != null && Number.isFinite(value) && value !== 0) parts.push(`${name}(${num(Math.max(0, 1 + value))})`);
  };
  around("brightness", adjust.brightness);
  around("contrast", adjust.contrast);
  around("saturate", adjust.saturation);
  if (adjust.greyscale) parts.push("grayscale(1)");
  if (adjust.blur != null && Number.isFinite(adjust.blur) && adjust.blur > 0) parts.push(`blur(${num(adjust.blur)}px)`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** The clip path that cuts a box of `w` x `h` to the preset shape `name`; undefined for no shape. */
export function maskClip(name: string | null | undefined, w: number, h: number): string | undefined {
  if (!name || w <= 0 || h <= 0) return undefined;
  return `path("${shapePath(name, w, h)}")`;
}
