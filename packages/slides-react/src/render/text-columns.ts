// A text box set in two or three columns: how many, and the space between them, from what the deck says (which may be anything).

import type { CSSProperties } from "react";

/** The columns a box runs its words in: 2 or 3, else 1 (one column is no columns at all). */
export function columnsOf(value: unknown): 1 | 2 | 3 {
  return value === 2 || value === 3 ? value : 1;
}

/** The space between columns in slide units, when the deck names a sensible one. */
export function gapOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 480 ? value : undefined;
}

/** The class that sets the words in columns, none for one column. */
export const columnClass = (columns: 1 | 2 | 3): string | undefined => (columns === 1 ? undefined : `ks-cols-${columns}`);

/** The style that carries the gap down to the box of words. */
export const gapStyle = (gap: number | undefined): CSSProperties | undefined => (gap === undefined ? undefined : ({ "--ks-col-gap": `${gap}px` } as CSSProperties));
