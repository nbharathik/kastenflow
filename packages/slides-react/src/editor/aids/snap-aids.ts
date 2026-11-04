// The rulers, grid and guides of a deck, as the numbers the editor's snapping and drawing work from.

import type { Guide, Guides } from "@kasten-slides/wasm";

/** What snapping takes from the guides saved with the deck: the lines, by the axis they are measured along, and the grid. */
export function snapAidsOf(guides: Guides | null | undefined): { lines: { x: number[]; y: number[] }; grid: number } {
  const lines = { x: [] as number[], y: [] as number[] };
  for (const guide of guides?.lines ?? []) (guide.axis === "vertical" ? lines.x : lines.y).push(guide.at);
  return { lines, grid: guides?.grid ?? 0 };
}

/** The guides with the one at `index` moved to `at`, or taken away when `at` is null. Positions are kept to a tenth of a unit. */
export function movedGuide(lines: readonly Guide[], index: number, at: number | null): Guide[] {
  return lines.flatMap((guide, i) => (i !== index ? [guide] : at === null ? [] : [{ ...guide, at: Math.round(at * 10) / 10 }]));
}

/** The guides with a new one on `axis` at `at`; a guide already there is not doubled. */
export function addedGuide(lines: readonly Guide[], axis: Guide["axis"], at: number): Guide[] {
  const rounded = Math.round(at * 10) / 10;
  return lines.some((guide) => guide.axis === axis && guide.at === rounded) ? [...lines] : [...lines, { axis, at: rounded }];
}
