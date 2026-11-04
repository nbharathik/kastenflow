// A deck's `Style` (fill, outline, shadow) as what SVG and CSS are told.

import type { Dash, Gradient, Shadow, Stroke, Style, Theme } from "@kasten-slides/wasm";

import { colorOf } from "../theme/index.ts";
import { num } from "./format.ts";

/** How thick an outline is when the deck names a colour but no width: 1 unit, PowerPoint's 0.75 pt. */
export const DEFAULT_STROKE_WIDTH = 1;

/** Dash and gap lengths in units of the line's width, as PowerPoint draws its presets. */
const PATTERNS: Readonly<Record<Dash, readonly number[]>> = {
  solid: [],
  dash: [4, 3],
  dot: [1, 3],
  dashDot: [4, 3, 1, 3],
  longDash: [8, 3],
};

/** The `stroke-dasharray` for a dash pattern on a line `width` units thick; undefined for a solid line. */
export function dashArray(dash: Dash | null | undefined, width: number): string | undefined {
  const pattern = dash ? PATTERNS[dash] : undefined;
  if (!pattern || pattern.length === 0) return undefined;
  const unit = Math.max(width, 0.5);
  return pattern.map((part) => num(part * unit)).join(" ");
}

/** What an SVG shape is painted with. */
export interface Paint {
  fill: string;
  /** Colours that blend, painted in place of `fill` (which stays as the nearest solid colour). */
  gradient?: Gradient;
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string | undefined;
}

export function strokeWidthOf(stroke: Stroke | null | undefined): number {
  return stroke ? Math.max(0, stroke.width ?? DEFAULT_STROKE_WIDTH) : 0;
}

/** Fill and outline of an SVG shape: `none` for what the style does not name. */
export function paintOf(theme: Theme, style: Style | null | undefined): Paint {
  const stroke = style?.stroke;
  const width = strokeWidthOf(stroke);
  const gradient = style?.gradient && style.gradient.stops.length >= 2 ? style.gradient : undefined;
  return {
    fill: style?.fill ? colorOf(theme, style.fill.color, style.fill.alpha) : gradient ? colorOf(theme, gradient.stops[0]?.color ?? "text1") : "none",
    ...(gradient ? { gradient } : {}),
    stroke: stroke && width > 0 ? colorOf(theme, stroke.color, stroke.alpha) : "none",
    strokeWidth: width,
    strokeDasharray: dashArray(stroke?.dash, width),
  };
}

/** The SVG `<stop>`s of a gradient and the line (or circle) they blend along, in the unit square of the shape. */
export function gradientParts(theme: Theme, gradient: Gradient): { stops: { offset: string; color: string }[]; line: { x1: string; y1: string; x2: string; y2: string } } {
  const stops = [...gradient.stops]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => ({ offset: num(Math.min(Math.max(s.pos, 0), 1)), color: colorOf(theme, s.color, s.alpha) }));
  // PowerPoint's angle runs clockwise from left to right; the line is drawn through the middle of the shape.
  const turn = ((gradient.angle ?? 90) * Math.PI) / 180;
  const [dx, dy] = [Math.cos(turn) / 2, Math.sin(turn) / 2];
  return { stops, line: { x1: num(0.5 - dx), y1: num(0.5 - dy), x2: num(0.5 + dx), y2: num(0.5 + dy) } };
}

/** The CSS `filter` that casts a shadow, or undefined when the style has none. */
export function shadowFilter(theme: Theme, shadow: Shadow | null | undefined): string | undefined {
  if (!shadow) return undefined;
  const color = colorOf(theme, shadow.color, shadow.alpha);
  return `drop-shadow(${num(shadow.dx)}px ${num(shadow.dy)}px ${num(Math.max(0, shadow.blur))}px ${color})`;
}

/** Whether the style paints anything on a shape's box: a fill, an outline that is thick enough to see, or a shadow. */
export function paintsBox(style: Style | null | undefined): boolean {
  return Boolean(style && (style.fill || style.gradient || style.shadow || strokeWidthOf(style.stroke) > 0));
}
