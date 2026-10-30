// What pasting a block of cells into the table changes: each pasted cell is
// read by its column's type, filled into the row it lands on, and rows past
// the last become new pages carrying the tag. Pure and table-tested; the
// changes are for ONE batch (one commit, one Undo), so a paste holds at most
// as many changes as a batch does.

import { createPage } from "../../../../lib/vault/batch-changes";
import { BATCH_LIMITS, type BatchChange } from "../../../../lib/vault/batch-types";
import type { NoteMeta, PropDef } from "../../../../lib/vault/types";
import { propOf } from "../../../panel/properties/values";
import type { Column } from "./columns";
import { sameValue } from "./format";

/** The most pasted rows, whatever they hold. */
export const MAX_PASTE_ROWS = 1000;

/** A cell read by its column: `value` is what to store (null clears it), or undefined for nothing; `bad` are the pieces that do not fit. */
export interface Parsed {
  value: unknown;
  bad: string[];
}

const no = (text: string): Parsed => ({ value: undefined, bad: [text] });
const pad = (n: number) => String(n).padStart(2, "0");

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

function numberOf(text: string): number | null {
  const t = text.replace(/\s/g, "");
  const plain = THOUSANDS.test(t) ? t.replaceAll(",", "") : t;
  if (!NUMBER.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthOf(name: string): number {
  const lower = name.toLowerCase();
  return lower.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(lower)) + 1 : 0;
}

function real(y: number, m: number, d: number): boolean {
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** A day as `YYYY-MM-DD` (with `THH:MM` when it came with a time); null when it is not a date. Day-first and month-first numbers are not guessed. */
function dayText(text: string): string | null {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(text);
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(text);
  const monthFirst = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dayFirst) [y, m, d] = [Number(dayFirst[3]), monthOf(dayFirst[2]!), Number(dayFirst[1])];
  else if (monthFirst) [y, m, d] = [Number(monthFirst[3]), monthOf(monthFirst[1]!), Number(monthFirst[2])];
  else return null;
  if (!real(y, m, d)) return null;
  const day = `${y}-${pad(m)}-${pad(d)}`;
  if (!iso?.[4]) return day;
  const [h, min] = [Number(iso[4]), Number(iso[5])];
  return h < 24 && min < 60 ? `${day}T${pad(h)}:${pad(min)}` : null;
}

const YES = /^(true|yes|y|1|x|✓|✔|☑|checked|on)$/i;
const NOPE = /^(false|no|n|0|unchecked|off)$/i;
const LINK = /^([a-z][a-z0-9+.-]*:\/\/\S+|mailto:\S+)$/i;

/** The schema's spelling of an option, or null; any text when the property lists none. */
const optionOf = (def: PropDef, text: string) => (def.options.length === 0 ? text : (def.options.find((o) => o.toLowerCase() === text.toLowerCase()) ?? null));

/** One cell's text as the value its property stores. An empty cell clears the value. */
export function parseCell(def: PropDef, raw: string): Parsed {
  const text = raw.trim();
  if (text === "") return { value: null, bad: [] };
  switch (def.type) {
    case "number": {
      const n = numberOf(text);
      return n === null ? no(text) : { value: n, bad: [] };
    }
    case "date": {
      const day = dayText(text);
      return day === null ? no(text) : { value: day, bad: [] };
    }
    case "checkbox":
      return YES.test(text) ? { value: true, bad: [] } : NOPE.test(text) ? { value: false, bad: [] } : no(text);
    case "select": {
      const option = optionOf(def, text);
      return option === null ? no(text) : { value: option, bad: [] };
    }
    case "multi_select": {
      const good: string[] = [];
      const bad: string[] = [];
      for (const part of text.split(/[,;]/).map((p) => p.trim())) {
        if (!part) continue;
        const option = optionOf(def, part);
        if (option === null) bad.push(part);
        else if (!good.some((g) => g.toLowerCase() === option.toLowerCase())) good.push(option);
      }
      return { value: good.length > 0 ? good : undefined, bad };
    }
    case "url":
      return LINK.test(text) ? { value: text, bad: [] } : no(text);
    default:
      return { value: text, bad: [] };
  }
}

export interface PasteInput {
  /** The pasted cells, row by row (ragged rows allowed). */
  grid: readonly (readonly string[])[];
  /** The active cell the block lands on, among the rows and columns shown. */
  at: { row: number; col: number };
  columns: readonly Column[];
  /** The rows shown, top to bottom. */
  notes: readonly NoteMeta[];
  tag: string;
  /** Values a new row takes from the view's filters, so it shows up here. */
  fill: Record<string, unknown>;
  /** Where new pages go (a database in a page keeps its rows under it). */
  home: { project: string | null; parent: string | null } | null;
  /** Whether this table can make rows (a project's saved table cannot). */
  canAdd: boolean;
  /** The most changes to plan; a batch holds 100. */
  maxChanges?: number;
}

export interface Unfit {
  value: string;
  /** The column's key. */
  column: string;
  /** The pasted row, from 1. */
  row: number;
}

export interface PastePlan {
  changes: BatchChange[];
  /** Existing rows changed, and new rows made. */
  touched: number;
  added: number;
  /** Cells read into the plan, changed or not. */
  cells: number;
  invalid: Unfit[];
  /** Columns the paste crossed that cannot take one (calculated, linked, read-only). */
  skippedColumns: string[];
  leftOutColumns: number;
  /** Rows past the last, in a table that cannot add rows. */
  leftOutRows: number;
  /** Pasted rows planned, and rows that did not fit in one batch. */
  keptRows: number;
  cutRows: number;
  /** One plain sentence when nothing can be pasted at all. */
  refused: string | null;
}

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

interface RowPlan {
  changes: BatchChange[];
  invalid: Unfit[];
  skipped: string[];
  cells: number;
  leftOut: number;
  existing: boolean;
}

/** What one pasted row does to the row it lands on. */
function planRow(input: PasteInput, cells: readonly string[], index: number): RowPlan {
  const { at, columns, notes, tag, fill, home } = input;
  const existing = notes[at.row + index];
  const out: RowPlan = { changes: [], invalid: [], skipped: [], cells: 0, leftOut: 0, existing: existing !== undefined };
  const props: Record<string, unknown> = {};
  let title: string | null = null;
  for (const [j, raw] of cells.entries()) {
    const column = columns[at.col + j];
    if (!column) {
      out.leftOut = cells.length - j;
      break;
    }
    if (column.kind === "title") {
      out.cells++;
      if (raw.trim()) title = raw.trim();
      continue;
    }
    const def = column.def;
    if (column.kind !== "prop" || !def || def.type === "formula" || def.type === "relation") {
      out.skipped.push(column.key);
      continue;
    }
    const parsed = parseCell(def, raw);
    for (const value of parsed.bad) out.invalid.push({ value, column: column.key, row: index + 1 });
    if (parsed.value === undefined) continue;
    out.cells++;
    if (existing) {
      if (!sameValue(propOf(existing.props, column.key) ?? null, parsed.value)) props[column.key] = parsed.value;
    } else if (parsed.value !== null) {
      props[column.key] = parsed.value;
    }
  }
  if (existing) {
    if (Object.keys(props).length > 0) out.changes.push({ kind: "update_props", path: existing.path, props });
    if (title !== null && title !== existing.title) out.changes.push({ kind: "rename", path: existing.path, title });
  } else if (title !== null || Object.keys(props).length > 0) {
    out.changes.push(createPage({ title: title ?? "Untitled", tags: [tag], props: { ...fill, ...props }, ...(home?.parent ? { parent: home.parent } : {}), project: home?.project }));
  }
  return out;
}

export function planPaste(input: PasteInput): PastePlan {
  const { grid, notes, at, canAdd } = input;
  const maxChanges = input.maxChanges ?? BATCH_LIMITS.changes;
  const plan: PastePlan = { changes: [], touched: 0, added: 0, cells: 0, invalid: [], skippedColumns: [], leftOutColumns: 0, leftOutRows: 0, keptRows: 0, cutRows: 0, refused: null };
  if (grid.length > MAX_PASTE_ROWS) {
    plan.refused = `A paste can hold up to ${thousands(MAX_PASTE_ROWS)} rows and this one has ${thousands(grid.length)}. Paste it in smaller parts.`;
    return plan;
  }
  const skipped = new Set<string>();
  for (const [i, cells] of grid.entries()) {
    if (at.row + i >= notes.length && !canAdd) {
      plan.leftOutRows++;
      plan.keptRows++;
      continue;
    }
    const row = planRow(input, cells, i);
    if (plan.changes.length + row.changes.length > maxChanges) {
      plan.cutRows = grid.length - i;
      break;
    }
    plan.keptRows++;
    plan.changes.push(...row.changes);
    plan.invalid.push(...row.invalid);
    plan.cells += row.cells;
    plan.leftOutColumns = Math.max(plan.leftOutColumns, row.leftOut);
    for (const key of row.skipped) skipped.add(key);
    if (row.changes.length > 0) {
      if (row.existing) plan.touched++;
      else plan.added++;
    }
  }
  plan.skippedColumns = [...skipped];
  return plan;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const list = (items: readonly string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** What the toast says after a paste: what it did, then what it could not. */
export function pasteNotice(plan: PastePlan): string {
  const rows = plan.touched + plan.added;
  const total = plan.keptRows + plan.cutRows;
  let text: string;
  if (plan.changes.length === 0) text = plan.invalid.length > 0 ? "Nothing was pasted" : "Nothing changed: the cells already held those values";
  else if (plan.cutRows > 0) text = `Pasted ${plan.keptRows.toLocaleString()} of ${total.toLocaleString()} rows${plan.added > 0 ? ` (${plan.added.toLocaleString()} new)` : ""}`;
  else text = `Pasted ${plural(rows, "row")}${plan.added > 0 ? ` (${plan.added.toLocaleString()} new)` : ""}`;
  const more: string[] = [];
  if (plan.invalid.length > 0) {
    const n = plan.invalid.length;
    const named = plan.invalid.slice(0, 3).map((u) => `“${u.value}” in ${u.column}`);
    more.push(`${plural(n, "value")} did not fit and ${n === 1 ? "was" : "were"} left empty: ${named.join(", ")}${n > 3 ? ` and ${n - 3} more` : ""}`);
  }
  if (plan.skippedColumns.length > 0) more.push(`Skipped ${list(plan.skippedColumns)}: they are calculated, linked or read-only`);
  if (plan.leftOutColumns > 0) more.push(`${plural(plan.leftOutColumns, "column")} past the table's last ${plan.leftOutColumns === 1 ? "was" : "were"} left out`);
  if (plan.leftOutRows > 0) more.push(`${plural(plan.leftOutRows, "row")} past the last ${plan.leftOutRows === 1 ? "was" : "were"} left out, because this table cannot add rows`);
  return text + more.map((s) => `. ${s}`).join("");
}

/** A paste that makes more new pages than this asks first (a block of prose would make a page per line). */
export const ASK_ABOVE_NEW = 20;

/** The question when a paste would make many new pages. */
export function addQuestion(plan: PastePlan): string {
  return `This paste would make ${plan.added.toLocaleString()} new pages. Make them?`;
}

/** The question when a paste is more than one batch holds. */
export function cutQuestion(plan: PastePlan): string {
  const total = plan.keptRows + plan.cutRows;
  return `One paste holds up to ${BATCH_LIMITS.changes} changes, so ${plan.keptRows.toLocaleString()} of these ${total.toLocaleString()} rows fit. Paste those?`;
}
