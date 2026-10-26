// "Turn into database": what a Markdown table becomes as notes. The header row
// names the properties, the first column is each note's title, the other cells
// are its properties, and a column whose cells all look like numbers, dates or
// yes/no is typed that way. This file only plans; making the database is one
// request to the page's host (LinkProvider.turnTableIntoDatabase), which runs
// the batch built here as the single commit that does everything, the page's
// table replaced by the embed included.

import type { Node } from "@milkdown/kit/prose/model";

import { createPage, newTagSchema, replaceBlock } from "../../../../lib/vault/batch-changes";
import type { BatchChange } from "../../../../lib/vault/batch-types";
import type { PropDef } from "../../../../lib/vault/types";
import { tagFrom } from "../links";
import type { Grid } from "./grid";

export type ColumnKind = "text" | "number" | "date" | "checkbox";

/** The most rows one database is made from: one batch holds at most a hundred changes, and two of them are the tag's schema and the page. */
export const MAX_ROWS = 98;

export interface PlannedNote {
  title: string;
  /** Property values by key; empty cells are left out. */
  props: Record<string, unknown>;
}

export interface DatabasePlan {
  /** The name as asked ("Reading list") and the tag it makes (`reading-list`). */
  name: string;
  tag: string;
  /** One per column after the first. */
  properties: PropDef[];
  notes: PlannedNote[];
}

const YES = new Set(["yes", "true", "x", "✓", "✔", "[x]"]);
const NO = new Set(["no", "false", "✗", "✘", "[ ]"]);

const isNumber = (s: string) => /^[-+]?\d+(?:\.\d+)?$/.test(s);
function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** What a column's cells look like. A column with no text in it is text. */
export function guessKind(cells: readonly string[]): ColumnKind {
  const filled = cells.map((c) => c.trim()).filter((c) => c !== "");
  if (filled.length === 0) return "text";
  if (filled.every(isNumber)) return "number";
  if (filled.every(isDate)) return "date";
  const flags = filled.map((c) => c.toLowerCase());
  if (flags.every((c) => YES.has(c) || NO.has(c))) return "checkbox";
  return "text";
}

function valueOf(kind: ColumnKind, cell: string): unknown {
  const text = cell.trim();
  if (text === "") return undefined;
  if (kind === "number") return Number(text);
  if (kind === "checkbox") return YES.has(text.toLowerCase());
  return text;
}

/** Property keys from the headers after the first column: no colon, hash or line
 * break (a property name cannot hold them), and unique among the keys before it. */
function keysOf(header: readonly string[]): string[] {
  const used = new Set<string>();
  return header.map((text, i) => {
    const base = text.replace(/[:#\r\n]+/g, " ").replace(/\s+/g, " ").trim() || `Column ${i + 2}`;
    let key = base;
    for (let n = 2; used.has(key.toLowerCase()); n++) key = `${base} ${n}`;
    used.add(key.toLowerCase());
    return key;
  });
}

/** The plan for `grid` as a database called `name`, or a plain sentence saying why not. */
export function planDatabase(grid: Pick<Grid, "header" | "rows">, name: string): DatabasePlan | { error: string } {
  const tag = tagFrom(name);
  if (!tag) return { error: "Give the database a name with letters or numbers in it." };
  if (grid.header.length < 1 || grid.rows.length === 0) return { error: "This table has no rows to turn into notes." };
  if (grid.rows.length > MAX_ROWS) return { error: `A table can become a database up to ${MAX_ROWS} rows; this one has ${grid.rows.length}. Split it first.` };
  const keys = keysOf(grid.header.slice(1));
  const kinds = keys.map((_, i) => guessKind(grid.rows.map((row) => row[i + 1] ?? "")));
  const properties: PropDef[] = keys.map((key, i) => ({ key, type: kinds[i]!, options: [] }));
  const notes = grid.rows.map((row, r) => {
    const props: Record<string, unknown> = {};
    keys.forEach((key, i) => {
      const value = valueOf(kinds[i]!, row[i + 1] ?? "");
      if (value !== undefined) props[key] = value;
    });
    return { title: (row[0] ?? "").trim() || `Row ${r + 1}`, props };
  });
  return { name: name.trim(), tag, properties, notes };
}

/** The name offered first: the heading above the table, else "Table". */
export function defaultName(doc: Node, tablePos: number): string {
  let name = "";
  doc.forEach((node, offset) => {
    if (offset < tablePos && node.type.name === "heading" && node.textContent.trim() !== "") name = node.textContent.trim();
  });
  return name || "Table";
}

/** Which table of the page: its place among the page's tables (from 0), how many the page has, and its size (the header row counts). */
export interface TableSpot {
  index: number;
  count: number;
  rows: number;
  columns: number;
}

/** Where the new notes go: under the page that holds the table, or, for a note that holds no pages, in its project. */
export type NotesHome = { parent: string } | { project: string | null };

/** The view the database starts with, and the one the page embeds. */
export const FIRST_VIEW = "Table";

/** A page's notes: one per row, tagged and carrying the cells as properties. */
export function noteChanges(plan: DatabasePlan, home: NotesHome): BatchChange[] {
  return plan.notes.map((note) => createPage({ title: note.title, tags: [plan.tag], props: note.props, ...("parent" in home ? { parent: home.parent } : { project: home.project }) }));
}

/**
 * The whole batch that turns the table into a database: the tag's schema (the
 * properties and a table view), a note for each row, and the page with the
 * table `block` written again as the embed of `file`'s first view. One commit
 * and one Undo; the core refuses all of it if any part is refused.
 */
export function databaseChanges(plan: DatabasePlan, home: NotesHome, page: { path: string; block: { id: string; hash: string } }, file: string): BatchChange[] {
  return [
    newTagSchema(plan.tag, plan.properties, [{ name: FIRST_VIEW, type: "table" }]),
    ...noteChanges(plan, home),
    replaceBlock(page.path, page.block, `![[${file}#${FIRST_VIEW}]]\n`),
  ];
}
