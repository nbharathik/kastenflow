// Adding and taking away the last row or column of tables: what the panel's steppers do when no cells are picked. The engine's own table
// operations do the work (the box grows and shrinks with the rows and columns, within the slide), so this only says which and where.

import type { Element } from "@kasten-slides/wasm";

import type { EditorSession } from "../../session/session.ts";

type TableEl = Extract<Element, { type: "table" }>;
type Direction = "row" | "column";
type Operations = Parameters<EditorSession["core"]["applyBatch"]>[0];

const sizeOf = (table: TableEl, along: Direction): number => (along === "row" ? table.rows.length : table.columns.length);

/** Whether the table has room to lose a row or a column. */
export const canShrink = (table: TableEl, along: Direction): boolean => sizeOf(table, along) > 1;

/** One more row or column at the end of each table: one step of undo for all. */
export function addAtEnd(session: EditorSession, tables: readonly TableEl[], along: Direction): void {
  const slide = session.state.slideId;
  const operations: Operations = tables.map((table) =>
    along === "row" ? ["insert_rows", { slide, id: table.id, at: sizeOf(table, along), count: 1 }] : ["insert_columns", { slide, id: table.id, at: sizeOf(table, along), count: 1 }],
  );
  if (operations.length > 0) session.run(() => session.core.applyBatch(operations));
}

/** Each table without its last row or column (a table of one is left): one step of undo for all. */
export function removeAtEnd(session: EditorSession, tables: readonly TableEl[], along: Direction): void {
  const slide = session.state.slideId;
  const operations: Operations = tables
    .filter((table) => canShrink(table, along))
    .map((table) => (along === "row" ? ["delete_rows", { slide, id: table.id, from: sizeOf(table, along) - 1, count: 1 }] : ["delete_columns", { slide, id: table.id, from: sizeOf(table, along) - 1, count: 1 }]));
  if (operations.length > 0) session.run(() => session.core.applyBatch(operations));
}
