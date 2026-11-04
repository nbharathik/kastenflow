import type { Style, Theme } from "@kasten-slides/wasm";
import { type JSX, useId } from "react";

import { gradientParts, paintOf, shadowFilter } from "../style.ts";
import { type ShapeAdjust, shapePath } from "../shapes/index.ts";

export interface ShapeGraphicProps {
  theme: Theme;
  style: Style | null | undefined;
  /** The preset to draw: `rect`, `ellipse`, ... */
  name: string;
  w: number;
  h: number;
  adjust?: number | ShapeAdjust | null | undefined;
}

/** A preset shape as SVG, in its box: fill (solid or a gradient), outline, dashes and shadow from the style. */
export function ShapeGraphic({ theme, style, name, w, h, adjust }: ShapeGraphicProps): JSX.Element {
  const paint = paintOf(theme, style);
  const filter = shadowFilter(theme, style?.shadow);
  const gradientId = `ks-grad-${useId().replaceAll(":", "")}`;
  const blend = paint.gradient ? gradientParts(theme, paint.gradient) : null;
  // An SVG with no width or height draws nothing, so a shape with no size still gets a box.
  const width = Math.max(w, 1);
  const height = Math.max(h, 1);
  const stops = blend?.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />);
  return (
    <svg className="ks-shape" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={filter ? { filter } : undefined} aria-hidden="true">
      {blend && paint.gradient ? (
        <defs>
          {paint.gradient.kind === "radial" ? (
            <radialGradient id={gradientId} cx="0.5" cy="0.5" r="0.5">
              {stops}
            </radialGradient>
          ) : (
            <linearGradient id={gradientId} x1={blend.line.x1} y1={blend.line.y1} x2={blend.line.x2} y2={blend.line.y2}>
              {stops}
            </linearGradient>
          )}
        </defs>
      ) : null}
      <path
        d={shapePath(name, w, h, adjust)}
        fill={blend ? `url(#${gradientId})` : paint.fill}
        stroke={paint.stroke}
        strokeWidth={paint.strokeWidth}
        strokeDasharray={paint.strokeDasharray}
        strokeLinejoin="round"
      />
    </svg>
  );
}
