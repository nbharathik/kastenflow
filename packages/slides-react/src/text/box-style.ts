// The box that text sits in. TextBlock and the editor build it from the same
// function, which is what keeps words in place when editing starts.

import type { Insets, Text, VAlign } from "@kasten-slides/wasm";

import { type Css, px } from "./css.ts";
import { DEFAULT_INSETS } from "./metrics.ts";

export interface BoxSettings {
  /** The box size in slide units. */
  width: number;
  height: number;
  /** Space between the edge and the text; the text's own `insets` win. */
  insets?: Insets | null | undefined;
  /** Where the text sits in the box; the text's own `valign` wins. */
  valign?: VAlign | null | undefined;
  /** How much "shrink text on overflow" has set the type smaller (1 is not at all). The box is laid out as if it were that much bigger and drawn that much smaller, so lines wrap as they would at the smaller type and the insets keep their size. */
  scale?: number | null | undefined;
}

const JUSTIFY: Readonly<Record<VAlign, string>> = { top: "flex-start", middle: "center", bottom: "flex-end" };

const finite = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);

/** The insets and vertical alignment a text is drawn with: its own, else the box's, else the defaults. */
export function boxOf(text: Pick<Text, "insets" | "valign">, settings: Pick<BoxSettings, "insets" | "valign">): { insets: Insets; valign: VAlign } {
  const insets = text.insets ?? settings.insets ?? DEFAULT_INSETS;
  return {
    insets: {
      left: finite(insets.left, DEFAULT_INSETS.left),
      top: finite(insets.top, DEFAULT_INSETS.top),
      right: finite(insets.right, DEFAULT_INSETS.right),
      bottom: finite(insets.bottom, DEFAULT_INSETS.bottom),
    },
    valign: text.valign ?? settings.valign ?? "top",
  };
}

/** The scale a box is drawn at: 1 unless a usable number below it says otherwise. */
export const scaleOf = (scale: number | null | undefined): number => (typeof scale === "number" && Number.isFinite(scale) && scale > 0.05 && scale < 1 ? scale : 1);

/**
 * The box itself: it fills its parent, stacks paragraphs from the top, the
 * middle or the bottom, and lets long text run past its edge. It also fixes
 * the inherited settings a page might change (spacing, case, ligatures), so
 * slide text does not depend on the CSS around it.
 */
export function boxCss(settings: BoxSettings, text: Pick<Text, "insets" | "valign" | "wrap"> = {}): Css {
  const { insets, valign } = boxOf(text, settings);
  const scale = scaleOf(settings.scale);
  const wraps = text.wrap !== false;
  const css: Css = {
    position: "absolute",
    inset: "0px",
    width: px(settings.width / scale),
    height: px(settings.height / scale),
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    justifyContent: JUSTIFY[valign],
    padding: `${px(insets.top / scale)} ${px(insets.right / scale)} ${px(insets.bottom / scale)} ${px(insets.left / scale)}`,
    margin: "0px",
    overflow: "visible",
    whiteSpace: wraps ? "pre-wrap" : "pre",
    wordBreak: wraps ? "break-word" : "normal",
    overflowWrap: wraps ? "break-word" : "normal",
    letterSpacing: "normal",
    wordSpacing: "normal",
    textTransform: "none",
    textIndent: "0px",
    textShadow: "none",
    fontVariantLigatures: "none",
    fontFeatureSettings: "normal",
    hyphens: "manual",
  };
  if (scale !== 1) {
    css.transform = `scale(${Math.round(scale * 10000) / 10000})`;
    css.transformOrigin = "0 0";
  }
  return css;
}
