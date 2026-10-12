// A table view's columns: the title first, then
// the view's `columns` (unknown keys skipped) or every property of the tag.
// Hiding, showing, moving and sorting write the view; widths live in its
// `widths`. Pure functions, unit tested.

import type { PropDef, TagSchema, TagView } from "../../../../lib/vault/types";
import { BUILT_IN, ROW_FIELDS, ROW_LABELS, spans } from "../../model";
import { own } from "./format";

export type ColumnKind = "title" | "prop" | "builtin";

export interface Column {
  key: string;
  /** What its header says. */
  label: string;
  kind: ColumnKind;
  /** The property's type; "title" for the title, the key for built-ins. */
  type: string;
  /** The property's definition, for its options. */
  def: PropDef | null;
}

export const TITLE: Column = { key: "title", label: "Title", kind: "title", type: "title", def: null };

/** Fields every note has that a table can show, read-only. */
const FIELDS = ["created", "updated", "modified"] as const;


function propColumn(def: PropDef): Column {
  return { key: def.key, label: def.key, kind: "prop", type: def.type, def };
}

function fieldColumn(key: string): Column {
  return { key, label: BUILT_IN[key] ?? ROW_LABELS[key] ?? key, kind: "builtin", type: key, def: null };
}

/** The schema's properties a table can show: one called "title" would
 * stand beside the note's own title, under the same key. */
const propsOf = (schema: TagSchema | null) => (schema?.properties ?? []).filter((p) => p.key !== TITLE.key);

/** The column for `key`, or null when neither the schema nor the note has it. */
function columnFor(key: string, schema: TagSchema | null, view: TagView): Column | null {
  if (key === TITLE.key) return null;
  const def = schema?.properties.find((p) => p.key === key);
  if (def) return propColumn(def);
  if ((FIELDS as readonly string[]).includes(key)) return fieldColumn(key);
  return spans(view) && (ROW_FIELDS as readonly string[]).includes(key) ? fieldColumn(key) : null;
}

/** The columns after the title, as the view shows them. */
function shown(view: TagView, schema: TagSchema | null): Column[] {
  if (!Array.isArray(view.columns)) return propsOf(schema).map(propColumn);
  const out: Column[] = [];
  for (const key of view.columns) {
    if (typeof key !== "string" || key === TITLE.key || out.some((c) => c.key === key)) continue;
    const column = columnFor(key, schema, view);
    if (column) out.push(column);
  }
  return out;
}

/** Every column the table shows, the title first. */
export function tableColumns(view: TagView, schema: TagSchema | null): Column[] {
  return [TITLE, ...shown(view, schema)];
}

/** What the "+" menu offers: hidden properties, then built-in fields. */
export function hiddenColumns(view: TagView, schema: TagSchema | null): Column[] {
  const showing = new Set(shown(view, schema).map((c) => c.key));
  const props = propsOf(schema)
    .filter((p) => !showing.has(p.key))
    .map(propColumn);
  const own = new Set((schema?.properties ?? []).map((p) => p.key));
  const offered: readonly string[] = spans(view) ? [...FIELDS, ...ROW_FIELDS] : FIELDS;
  const fields = offered.filter((key) => !showing.has(key) && !own.has(key)).map(fieldColumn);
  return [...props, ...fields];
}

const withColumns = (view: TagView, keys: string[]): TagView => ({ ...view, columns: keys });

export function hideColumn(view: TagView, schema: TagSchema | null, key: string): TagView {
  const keys = shown(view, schema).map((c) => c.key);
  if (!keys.includes(key)) return view;
  return withColumns(
    view,
    keys.filter((k) => k !== key),
  );
}

export function showColumn(view: TagView, schema: TagSchema | null, key: string): TagView {
  const keys = shown(view, schema).map((c) => c.key);
  if (keys.includes(key) || !columnFor(key, schema, view)) return view;
  return withColumns(view, [...keys, key]);
}

/** Moves a column one place left (-1) or right (1) among the columns shown. */
export function moveColumn(view: TagView, schema: TagSchema | null, key: string, by: -1 | 1): TagView {
  const keys = shown(view, schema).map((c) => c.key);
  const from = keys.indexOf(key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= keys.length) return view;
  const next = keys.slice();
  [next[from], next[to]] = [next[to]!, next[from]!];
  return withColumns(view, next);
}

/** The direction the view sorts by `key` first, or null. */
export function sortOf(view: TagView, key: string): "asc" | "desc" | null {
  const first = view.sort?.[0];
  return first?.key === key ? first.dir : null;
}

/** The view sorted by `key` alone. */
export function sortColumn(view: TagView, key: string, dir: "asc" | "desc"): TagView {
  if (view.sort?.length === 1 && sortOf(view, key) === dir) return view;
  return { ...view, sort: [{ key, dir }] };
}

/** Widths a column starts at, by type. */
const DEFAULT_WIDTHS: Record<string, number> = {
  title: 300,
  text: 220,
  number: 120,
  select: 150,
  multi_select: 220,
  date: 150,
  checkbox: 96,
  url: 220,
  relation: 230,
  created: 170,
  updated: 170,
  modified: 140,
  project: 150,
  type: 110,
  tags: 220,
};

const MIN_WIDTH = 64;
const MIN_TITLE = 140;
const MAX_WIDTH = 900;

export function clampWidth(column: Column, px: number): number {
  const min = column.kind === "title" ? MIN_TITLE : MIN_WIDTH;
  return Math.round(Math.min(MAX_WIDTH, Math.max(min, px)));
}

const savedWidths = (view: TagView): Record<string, unknown> =>
  view.widths && typeof view.widths === "object" && !Array.isArray(view.widths) ? (view.widths as Record<string, unknown>) : {};

/** A column's width: the view's, else its type's. */
export function widthOf(view: TagView, column: Column): number {
  const saved = savedWidths(view)[column.key];
  if (typeof saved === "number" && Number.isFinite(saved)) return clampWidth(column, saved);
  return own(DEFAULT_WIDTHS, column.type) ?? DEFAULT_WIDTHS.text!;
}

/** The view with one column's width set; the others stay as they were. */
export function withWidth(view: TagView, column: Column, px: number): TagView {
  const width = clampWidth(column, px);
  if (savedWidths(view)[column.key] === width) return view;
  return { ...view, widths: { ...savedWidths(view), [column.key]: width } };
}

/** The CSS grid columns for these widths, and a filler to the table's edge. */
export function gridTemplate(widths: readonly number[]): string {
  return [...widths.map((w) => `${w}px`), "minmax(44px, 1fr)"].join(" ");
}
