// What "Fix with AI" is for, given what the last build said: errors first; if
// there are none, the warnings an assistant can put right (a reference or a
// citation with nothing behind it, and boxes that stick out into the margin).
// Anything else a build says is left to the person.

import type { Diagnostic } from "./types";

/** The slug of the AI action that suits the build, or null when there is nothing to fix. */
export type FixSlug = "fix-latex-errors" | "check-latex-refs" | "fix-overfull-boxes";

const UNDEFINED = /(reference|citation|label)s?\b.*\bundefined|undefined (reference|citation)|multiply defined/i;
const OVERFULL = /^overfull\b|\boverfull [hv]box/i;

export const isUndefinedRef = (d: Diagnostic): boolean => d.severity === "warning" && UNDEFINED.test(d.message);
export const isOverfull = (d: Diagnostic): boolean => d.severity !== "error" && OVERFULL.test(d.message);

/** The action for the build's problems, or null. */
export function fixAction(diagnostics: readonly Diagnostic[]): FixSlug | null {
  if (diagnostics.some((d) => d.severity === "error")) return "fix-latex-errors";
  if (diagnostics.some(isUndefinedRef)) return "check-latex-refs";
  if (diagnostics.some(isOverfull)) return "fix-overfull-boxes";
  return null;
}

const SAYS_UNICODE = /unicode character|requires either xetex or luatex|requires xetex or luatex/i;
const NEEDS_UNICODE_ENGINE = /^[^%\n]*\\usepackage[^%\n]*\b(fontspec|unicode-math|polyglossia)\b|\\setmainfont/m;

/** One sentence when a document built with pdfLaTeX needs XeLaTeX (Unicode text, or a package only XeTeX and LuaTeX load); the same rule the assistant is told (kasten-core's `engine_advice`). */
export function engineAdvice(engine: string, mainText: string, diagnostics: readonly Diagnostic[]): string | null {
  if (engine !== "latexmk-pdf") return null;
  const complained = diagnostics.some((d) => d.severity !== "info" && SAYS_UNICODE.test(d.message));
  if (!complained && !NEEDS_UNICODE_ENGINE.test(mainText)) return null;
  return "This document uses Unicode text or fontspec, which pdfLaTeX cannot build. Switch its engine to XeLaTeX (or LuaLaTeX) in the document's settings, or use Tectonic, instead of changing each character.";
}

/** What to tell the person when nothing in the build can be fixed that way. */
export const NOTHING_TO_FIX = "The last build has nothing to fix.";

/** The problem in words, to quote in a message: where it is, what TeX said, and where it stopped. */
export function problemPassage(d: Diagnostic, main: string): string {
  const file = d.file ?? main;
  const place = d.line === null ? file : `${file} line ${d.line}`;
  const kind = d.severity === "error" ? "Error" : d.severity === "warning" ? "Warning" : "Note";
  const stopped = d.context?.trim() ? `\nTeX stopped at:\n${d.context.trim()}` : "";
  return `${kind} in ${place}: ${d.message}${stopped}`;
}
