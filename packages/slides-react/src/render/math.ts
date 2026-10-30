// Formulas: what KaTeX makes of the LaTeX of a `math` element. The slide draws
// this, and so does the picture PowerPoint gets, so both come from here.

import katex from "katex";
import "katex/dist/katex.min.css";

import { provideMath } from "./math-slot.ts";

export { MATH_POINTS, hasFormula, mathSize } from "./math-size.ts";

/**
 * KaTeX's limits for LaTeX that anyone, or an agent, may have written into a
 * deck: no links or pictures (`trust`), and sizes and macro expansion capped,
 * so a formula can neither cover the slide nor hang the editor.
 */
const LIMITS = { trust: false, strict: "ignore", maxSize: 20, maxExpand: 500 } as const;

/** What a formula is drawn from: the HTML KaTeX made, or why it made none. */
export type Rendered = { ok: true; html: string } | { ok: false; message: string };

/** `html` is what a picture needs; `htmlAndMathml` adds the MathML that tells a screen reader what the formula says. */
export type MathOutput = "html" | "htmlAndMathml";

/** A formula that has been drawn once is not made again: slides are drawn often and formulas rarely change. */
const KEPT = 300;
const kept = new Map<string, Rendered>();

const messageOf = (thrown: unknown): string => {
  const text = thrown instanceof Error ? thrown.message : String(thrown);
  return text.replace(/^KaTeX parse error:\s*/, "");
};

/** The HTML for LaTeX, in a line of its own (`inline` false) or set tight within a line. Never throws. */
export function renderMath(latex: string, inline: boolean, output: MathOutput = "htmlAndMathml"): Rendered {
  const key = `${output === "html" ? "h" : "m"}${inline ? "i" : "d"}${latex}`;
  const known = kept.get(key);
  if (known) return known;
  let made: Rendered;
  try {
    made = { ok: true, html: katex.renderToString(latex, { ...LIMITS, displayMode: !inline, output, throwOnError: true }) };
  } catch (thrown) {
    made = { ok: false, message: messageOf(thrown) };
  }
  if (kept.size >= KEPT) {
    const oldest = kept.keys().next();
    if (!oldest.done) kept.delete(oldest.value);
  }
  kept.set(key, made);
  return made;
}

// Slides draw formulas through this, once the code is here (see `math-slot.ts`).
provideMath({ renderMath });
