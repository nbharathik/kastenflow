// The calculations of a table's foot and group headers: which ones a column's
// type offers, and what each makes of a list of notes (the filtered rows, or
// one group's). Formula columns count as numbers or dates by what they hold.
// Pure, unit tested.

import { isoDay } from "../../../../lib/dates";
import type { NoteMeta, TagView } from "../../../../lib/vault/types";
import { valueOf } from "../../model";
import type { Column } from "./columns";

export type CalcFn =
  | "count"
  | "count_empty"
  | "count_not_empty"
  | "unique"
  | "percent_checked"
  | "sum"
  | "average"
  | "median"
  | "min"
  | "max"
  | "earliest"
  | "latest"
  | "range";

/** What each calculation is called in the menu, and in short beside its value. */
export const CALC_LABELS: Record<CalcFn, { menu: string; short: string }> = {
  count: { menu: "Count all", short: "Count" },
  count_empty: { menu: "Count empty", short: "Empty" },
  count_not_empty: { menu: "Count not empty", short: "Filled" },
  unique: { menu: "Count unique values", short: "Unique" },
  percent_checked: { menu: "Percent checked", short: "Checked" },
  sum: { menu: "Sum", short: "Sum" },
  average: { menu: "Average", short: "Avg" },
  median: { menu: "Median", short: "Median" },
  min: { menu: "Minimum", short: "Min" },
  max: { menu: "Maximum", short: "Max" },
  earliest: { menu: "Earliest date", short: "Earliest" },
  latest: { menu: "Latest date", short: "Latest" },
  range: { menu: "Range", short: "Range" },
};

const COMMON: CalcFn[] = ["count", "count_empty", "count_not_empty", "unique"];
const NUMBERS: CalcFn[] = ["sum", "average", "median", "min", "max", "range"];
const DATES: CalcFn[] = ["earliest", "latest", "range"];

/** The type a column's values have: its property's, or a built-in field's. */
export function kindOf(column: Pick<Column, "kind" | "type">): string {
  if (column.kind === "title") return "text";
  if (column.kind === "builtin") return column.type === "created" || column.type === "updated" ? "date" : column.type === "modified" ? "number" : column.type === "tags" ? "multi_select" : "text";
  return column.type;
}

/** The calculations a column of this type offers (the core refuses the others). */
export function calcsFor(kind: string): CalcFn[] {
  switch (kind) {
    case "checkbox":
      return [...COMMON, "percent_checked"];
    case "number":
      return [...COMMON, ...NUMBERS];
    case "date":
      return [...COMMON, ...DATES];
    case "formula":
      return [...COMMON, ...NUMBERS, "earliest", "latest"];
    default:
      return COMMON;
  }
}

/** The calculation a column starts with when the person asks to calculate it. */
export function defaultCalc(kind: string): CalcFn {
  return kind === "number" || kind === "formula" ? "sum" : kind === "checkbox" ? "percent_checked" : "count";
}

/** Whether the view shows the calculations row: it has a `calcs` setting, even an empty one. */
export const showsCalcs = (view: TagView): boolean => typeof view.calcs === "object" && view.calcs !== null && !Array.isArray(view.calcs);

/** The view with the calculations row shown or hidden (hiding forgets the calculations). */
export function withCalcRow(view: TagView, show: boolean): TagView {
  const next = { ...view };
  if (show) next.calcs = showsCalcs(view) ? view.calcs : {};
  else delete next.calcs;
  return next;
}

export const isCalc =(value: unknown): value is CalcFn => typeof value === "string" && Object.hasOwn(CALC_LABELS, value);

/** The calculation saved for a column, if it still suits the column. */
export function calcOf(view: TagView, column: Pick<Column, "key" | "kind" | "type">): CalcFn | null {
  const saved = view.calcs;
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return null;
  const fn = (saved as Record<string, unknown>)[column.key];
  return isCalc(fn) && calcsFor(kindOf(column)).includes(fn) ? fn : null;
}

/** The view with a column's calculation set (null clears it); other keys stay. */
export function withCalc(view: TagView, key: string, fn: CalcFn | null): TagView {
  const saved: Record<string, string> = {};
  if (showsCalcs(view)) for (const [k, v] of Object.entries(view.calcs!)) if (typeof v === "string") saved[k] = v;
  if (fn) saved[key] = fn;
  else delete saved[key];
  // Clearing the last one leaves the (empty) row shown.
  return { ...view, calcs: saved };
}

const isEmpty = (value: unknown, kind: string): boolean =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0) || (kind === "checkbox" && !(value === true || value === "true"));

const numberOf = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** The day a value names, or "". */
const dayOf = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? isoDay(new Date(value)) : typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const DAY_MS = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

export interface CalcResult {
  /** The value as the footer says it; "" when there is nothing to say. */
  text: string;
  /** The value as a number or an ISO day, for tests and checks. */
  value: number | string | null;
}

const NONE: CalcResult = { text: "", value: null };
const num = (n: number): CalcResult => ({ text: NUMBER.format(n), value: n });

/** What `fn` makes of the values `key` holds in `notes`. A value that does not
 * suit (text in a number column) is skipped; with none left the result is empty. */
export function calculate(fn: CalcFn, notes: readonly NoteMeta[], key: string, kind: string): CalcResult {
  const values = notes.map((n) => valueOf(n, key));
  switch (fn) {
    case "count":
      return num(values.length);
    case "count_empty":
      return num(values.filter((v) => isEmpty(v, kind)).length);
    case "count_not_empty":
      return num(values.filter((v) => !isEmpty(v, kind)).length);
    case "unique": {
      const seen = new Set<string>();
      for (const v of values) for (const item of Array.isArray(v) ? v : [v]) if (!isEmpty(item, "")) seen.add(String(item).trim().toLowerCase());
      return num(seen.size);
    }
    case "percent_checked": {
      if (values.length === 0) return NONE;
      const pct = (values.filter((v) => v === true || v === "true").length / values.length) * 100;
      return { text: `${Math.round(pct)}%`, value: Math.round(pct) };
    }
    case "earliest":
    case "latest": {
      const found = values.map(dayOf).filter(Boolean).sort();
      if (found.length === 0) return NONE;
      const day = fn === "earliest" ? found[0]! : found[found.length - 1]!;
      return { text: day, value: day };
    }
    default: {
      if (fn === "range" && kind === "date") {
        const found = values.map(dayOf).filter(Boolean).sort();
        if (found.length === 0) return NONE;
        const span = days(found[0]!, found[found.length - 1]!);
        return { text: `${span} ${span === 1 ? "day" : "days"}`, value: span };
      }
      const found = values.map(numberOf).filter((n): n is number => n !== null);
      if (found.length === 0) return NONE;
      if (fn === "sum") return num(found.reduce((a, b) => a + b, 0));
      if (fn === "average") return num(found.reduce((a, b) => a + b, 0) / found.length);
      if (fn === "min") return num(found.reduce((a, b) => Math.min(a, b)));
      if (fn === "max") return num(found.reduce((a, b) => Math.max(a, b)));
      if (fn === "range") return num(found.reduce((a, b) => Math.max(a, b)) - found.reduce((a, b) => Math.min(a, b)));
      const sorted = [...found].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return num(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
    }
  }
}

/** The footer's words for a result: "Sum 42". */
export const calcText = (fn: CalcFn, result: CalcResult): string => (result.text === "" && result.value === null ? CALC_LABELS[fn].short : `${CALC_LABELS[fn].short} ${result.text}`);
