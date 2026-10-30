import { type JSX } from "react";

import { colorOf, fontStack } from "../../theme/index.ts";
import type { ViewProps } from "../context.ts";
import { hasFormula, mathSize } from "../math-size.ts";
import { useMath } from "../math-slot.ts";
import "./math.css";

/** The empty formula, which an editor shows so that there is something to select. */
function EmptyFormula({ cx, size }: { cx: ViewProps<"math">["cx"]; size: number }): JSX.Element {
  return (
    <div className="ks-math-empty" style={{ borderColor: colorOf(cx.theme, "text2", 0.55), color: colorOf(cx.theme, "text2"), fontFamily: fontStack(cx.theme, "body"), fontSize: Math.min(size * 0.5, 18) }}>
      Formula
    </div>
  );
}

/**
 * A formula: KaTeX's HTML in the element's box, centred, at its size in points
 * (32 when it names none), in its colour (the text colour when it names none).
 * LaTeX that KaTeX cannot read is shown as its source in a red box, whose hover
 * text says what is wrong; nothing here throws.
 */
export function MathView({ element, cx }: ViewProps<"math">): JSX.Element | null {
  const size = mathSize(element.fontSize);
  const inline = element.inline === true;
  const label = element.alt ? { role: "img" as const, "aria-label": element.alt } : {};
  const math = useMath();
  if (!hasFormula(element.latex)) return cx.mode === "edit" ? <EmptyFormula cx={cx} size={size} /> : null;
  // KaTeX's code is still arriving: the formula appears as soon as it has.
  if (!math) return null;

  const rendered = math.renderMath(element.latex, inline);
  if (!rendered.ok) {
    return (
      <div className="ks-math ks-math-error" title={rendered.message} role="img" aria-label={element.alt ?? `Formula that cannot be drawn: ${rendered.message}`} style={{ fontFamily: fontStack(cx.theme, "code"), fontSize: Math.min(Math.max(size * 0.4, 12), 20) }}>
        <span className="ks-math-source">{element.latex}</span>
      </div>
    );
  }
  return (
    <div
      className="ks-math"
      data-inline={inline || undefined}
      style={{ color: colorOf(cx.theme, element.color ?? "text1"), fontSize: size }}
      {...label}
      // KaTeX's own markup, made from LaTeX with `trust` off.
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
