// The page sizes the page setup offers, and how to say a size to a person.

import { pageSizes } from "@kasten-slides/wasm";

/** A size of slide, in slide units (96 to an inch). */
export interface PageSize {
  /** The name `set_page_size` takes: `16:9`, `16:10`, `4:3` or `1:1`. */
  name: string;
  w: number;
  h: number;
}

/** What the engine gives when it is not loaded (a page that has not opened a deck); the engine's own list is what counts. */
const FALLBACK: PageSize[] = [
  { name: "16:9", w: 960, h: 540 },
  { name: "16:10", w: 960, h: 600 },
  { name: "4:3", w: 960, h: 720 },
  { name: "1:1", w: 720, h: 720 },
];

/** The sizes the engine offers by name, in the order a picker lists them. */
export function presetSizes(): PageSize[] {
  try {
    return pageSizes();
  } catch {
    return FALLBACK;
  }
}

/** The smallest and largest a side of a slide is, in inches: PowerPoint's own limits, and the engine's. */
export const LEAST_INCHES = 1;
export const MOST_INCHES = 56;

/** Slide units to inches, to two places. */
export const inchesOf = (units: number): number => Math.round((units / 96) * 100) / 100;

/** Inches to slide units, to two places. */
export const unitsOf = (inches: number): number => Math.round(inches * 96 * 100) / 100;

/** A size as it is said in the dialog: `10 × 5.63 in`. */
export function sizeText(size: { w: number; h: number }): string {
  return `${inchesOf(size.w)} × ${inchesOf(size.h)} in`;
}

/** The preset a size is, if it is one. */
export function presetOf(size: { w: number; h: number }, presets: readonly PageSize[] = presetSizes()): PageSize | undefined {
  return presets.find((preset) => Math.abs(preset.w - size.w) < 0.01 && Math.abs(preset.h - size.h) < 0.01);
}
