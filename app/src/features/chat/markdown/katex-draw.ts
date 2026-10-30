// Draws TeX with KaTeX, the renderer the page editor uses. Only loaded when an
// answer holds math (Math.tsx imports this lazily), so the chat's entry does
// not carry KaTeX or its stylesheet and fonts.

import "katex/dist/katex.min.css";

import katex from "katex";

import { KATEX } from "../../pages/editor/blocks/katex-limits";

/** Draws `tex` into `host` with the same limits as the page editor; says so, gently, when it does not parse. */
export function drawMath(host: HTMLElement, tex: string, display: boolean): void {
  try {
    katex.render(tex, host, { ...KATEX, displayMode: display, throwOnError: true });
    host.classList.remove("is-error");
  } catch {
    katex.render(tex, host, { ...KATEX, displayMode: display, throwOnError: false });
    host.classList.add("is-error");
  }
}
