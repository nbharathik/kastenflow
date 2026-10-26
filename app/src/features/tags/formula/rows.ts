// Calculated cells in a tag's rows: which properties are formulas, and the
// rows with the core's values laid over their properties. Pure, unit tested.

import type { FormulaFill, NoteMeta, PropDef, TagSchema } from "../../../lib/vault/types";

export const isFormula = (def: PropDef | null | undefined): boolean => def?.type === "formula";

/** The tag's formula properties. */
export const formulaDefs = (schema: TagSchema | null): PropDef[] => (schema?.properties ?? []).filter(isFormula);

/** Per note path and formula key, why a cell has no value. */
export type CellProblems = Record<string, Record<string, string>>;

export const NO_PROBLEMS: CellProblems = {};

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/** A calculated value as the views say it: numbers grouped, empty as nothing. */
export function formulaText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? NUMBER.format(value) : "";
  if (Array.isArray(value)) return value.map(formulaText).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** The rows with each formula's value set in their properties (a row the core
 * did not answer for keeps what it has, so its cells stay empty). The notes
 * passed in are not changed; a row without a value to set is the same object. */
export function withFormulas(notes: readonly NoteMeta[], fill: FormulaFill | null): NoteMeta[] {
  if (!fill) return [...notes];
  return notes.map((note) => {
    const cells = fill.values[note.path];
    if (!cells) return note;
    const base = typeof note.props === "object" && note.props !== null && !Array.isArray(note.props) ? note.props : {};
    return { ...note, props: { ...base, ...cells } };
  });
}
