// The four lines of a table cell as CSS: the cell's own, else its table style's, else the thin grid a
// table without a style is drawn with. A line of width 0 is no line.

import type { CellBorders, Stroke, Theme } from "@kasten-slides/wasm";
import type { CSSProperties } from "react";

import { colorOf } from "../theme/index.ts";
import type { CellLook } from "./table-style.ts";

type Side = "top" | "right" | "bottom" | "left";
const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];
const cap = (side: Side): "Top" | "Right" | "Bottom" | "Left" => (side === "top" ? "Top" : side === "right" ? "Right" : side === "bottom" ? "Bottom" : "Left");

/**
 * The border properties for a cell. With no style and no lines of its own the cell keeps the plain grid, which the stylesheet draws, so
 * nothing is returned for it.
 */
export function cellBorders(theme: Theme, look: CellLook | undefined, own: CellBorders | null | undefined): CSSProperties {
  if (!look && !own) return {};
  const out: Record<string, string> = {};
  for (const side of SIDES) {
    const stroke: Stroke | null | undefined = own?.[side] ?? look?.[side];
    const key = cap(side);
    if (stroke) {
      const width = stroke.width ?? 1;
      if (width <= 0) {
        out[`border${key}Style`] = "none";
      } else {
        out[`border${key}Width`] = `${width}px`;
        out[`border${key}Style`] = "solid";
        out[`border${key}Color`] = colorOf(theme, stroke.color, stroke.alpha);
      }
    } else if (look) {
      // A styled table draws only the lines its style names.
      out[`border${key}Style`] = "none";
    } else {
      out[`border${key}Color`] = colorOf(theme, "text2", 0.3);
    }
  }
  return out as CSSProperties;
}
