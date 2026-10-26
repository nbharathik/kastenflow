// How a calculated value looks in every view: a small sigma beside it that
// says "calculated" on hover, and for a cell the core could not work out a
// quiet warning chip with its sentence. Colours come from tokens (formula.css).

import "./formula.css";

import { useRowProblems } from "./use-formula-rows";

/** The calculated cue's tooltip, the same wherever it shows. */
export const CALCULATED = "Calculated from other properties; it cannot be edited here";

/** The sigma drawn like the shell's stroke icons. */
export function CalculatedCue() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="kasten-formula-cue">
      <path d="M18 6H7l6 6-6 6h11" />
    </svg>
  );
}

/** The reason a cell has no value, as a small warning chip; the full sentence is also its tooltip. */
export function ProblemChip({ sentence }: { sentence: string }) {
  return (
    <span role="note" className="kasten-formula-chip" title={sentence}>
      <span aria-hidden="true">!</span>
      <span className="kasten-formula-chip-text">{sentence}</span>
    </span>
  );
}

/** A note's problem chips for the formulas in `keys`, for cards and tiles. */
export function RowProblems({ path, keys }: { path: string; keys: readonly string[] }) {
  const problems = useRowProblems(path);
  const sentences = keys.flatMap((key) => (problems?.[key] ? [problems[key]!] : []));
  if (sentences.length === 0) return null;
  return (
    <>
      {sentences.map((sentence) => (
        <ProblemChip key={sentence} sentence={sentence} />
      ))}
    </>
  );
}
