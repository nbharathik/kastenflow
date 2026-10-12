// A project's saved tables: each is a name, a filter, columns and a sort (a
// tag database's table view with a `scope`), kept in the project page's
// `overview` property beside `home`. The core's properties hold text and lists
// of text, not nested mappings, so each table is one line of JSON in that list.
// Pure functions, unit tested.

import type { NoteMeta, TagView } from "../../../lib/vault/types";
import { applyView, freshName, readView, scoped } from "../../tags/model";

/** The most tables a project keeps. */
export const MAX_TABLES = 12;
const MAX_NAME = 60;

/** What a new table shows: each note's type, tags and times. */
export const DEFAULT_COLUMNS: readonly string[] = ["type", "tags", "updated", "created"];

export interface Overview {
  tables: TagView[];
}

export const NO_OVERVIEW: Overview = { tables: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A table's name as it is kept: one line, no brackets or bars, not too long. */
export const cleanName = (name: string): string => name.replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

/** The saved table written in `text`, or null when it is not one. */
export function readTable(text: unknown): TagView | null {
  if (typeof text !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const view = readView({ ...raw, name: typeof raw.name === "string" ? cleanName(raw.name) : "", type: "table", scope: raw.scope === "vault" ? "vault" : "project" });
  return view?.type === "table" ? view : null;
}

/** The overview a project page's properties hold: its tables in order, those that cannot be read left out, a name kept once. */
export function readOverview(props: Record<string, unknown> | null | undefined): Overview {
  const value = props?.overview;
  const tables: TagView[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const table = readTable(item);
    if (!table || seen.has(table.name.toLowerCase())) continue;
    seen.add(table.name.toLowerCase());
    tables.push(table);
    if (tables.length >= MAX_TABLES) break;
  }
  return { tables };
}

/** One table as a line of text: the keys the app knows first, in a steady order, the others after. */
export function tableText(table: TagView): string {
  const { name, type, scope, filter, sort, columns, widths, ...rest } = table;
  const known: Record<string, unknown> = { name, type: type ?? "table", scope: scope ?? "project" };
  if (filter) known.filter = filter;
  if (sort) known.sort = sort;
  if (columns) known.columns = columns;
  if (widths) known.widths = widths;
  return JSON.stringify({ ...known, ...rest });
}

/** The `overview` property for these tables: null (removed) for none, so a project page keeps no setting it does not need. */
export function overviewProp(overview: Overview): string[] | null {
  return overview.tables.length === 0 ? null : overview.tables.map(tableText);
}

/** A new table: a name no other has, nothing filtered, newest first, the usual columns. */
export function newTable(overview: Overview, name = "Table", over: Partial<TagView> = {}): TagView {
  return { name: freshName(overview.tables, cleanName(name) || "Table"), type: "table", scope: "project", filter: [], sort: [{ key: "updated", dir: "desc" }], columns: [...DEFAULT_COLUMNS], ...over };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The overview with `table` added at the end, up to the limit. */
export function addTable(overview: Overview, table: TagView): Overview {
  if (overview.tables.length >= MAX_TABLES) return overview;
  return { tables: [...overview.tables, { ...table, name: freshName(overview.tables, cleanName(table.name) || "Table") }] };
}

/** The table called `name` replaced by `next` (a rename keeps it unique). */
export function replaceTable(overview: Overview, name: string, next: TagView): Overview {
  const others = overview.tables.filter((t) => !same(t.name, name));
  const renamed = cleanName(next.name) || name;
  const unique = others.some((t) => same(t.name, renamed)) ? freshName(others, renamed) : renamed;
  return { tables: overview.tables.map((t) => (same(t.name, name) ? { ...next, name: unique } : t)) };
}

export function removeTable(overview: Overview, name: string): Overview {
  return { tables: overview.tables.filter((t) => !same(t.name, name)) };
}

/** The notes a saved table lists in `folder`'s project: its scope, then its filters and sorts (no tag schema, so only the built-in keys). */
export function tableNotes(notes: readonly NoteMeta[], table: TagView, folder: string): NoteMeta[] {
  return applyView(scoped(notes, table, folder), table, null);
}
