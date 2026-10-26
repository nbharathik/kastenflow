// How a table looks, from its view: row density, wrapped cells and whether
// the title column stays put. Rows stay one height (the list is windowed), so
// "wrap" makes rows two lines tall rather than as tall as their text.

import type { TagView } from "../../../../lib/vault/types";
import { ROW_HEIGHT } from "./context";

export type Density = "compact" | "comfortable";

/** Row heights in px, matching --row-h; comfortable without wrapping is the table's usual row. */
export const ROW_HEIGHTS = { compact: 28, comfortable: ROW_HEIGHT, compactWrap: 46, comfortableWrap: 56 } as const;

export const densityOf = (view: TagView): Density => (view.density === "compact" ? "compact" : "comfortable");
export const wrapOf = (view: TagView): boolean => view.wrap === true;
/** On unless the view turns it off. */
export const frozenOf = (view: TagView): boolean => view.freeze_title !== false;

export function rowHeightOf(view: TagView): number {
  const compact = densityOf(view) === "compact";
  if (wrapOf(view)) return compact ? ROW_HEIGHTS.compactWrap : ROW_HEIGHTS.comfortableWrap;
  return compact ? ROW_HEIGHTS.compact : ROW_HEIGHTS.comfortable;
}

/** The table's extra classes for the view's display settings. */
export function displayClasses(view: TagView): string {
  return `${densityOf(view) === "compact" ? " is-compact" : ""}${wrapOf(view) ? " is-wrap" : ""}${frozenOf(view) ? "" : " is-loose"}`;
}
