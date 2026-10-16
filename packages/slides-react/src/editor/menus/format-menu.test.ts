// The Format menu's rows for the highlight, the paint format and the cells of a table.

import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { table, textBox } from "../factory.ts";
import { selectionAt } from "../table/cells.ts";
import type { MenuItem } from "../ui/Menu.tsx";
import { barMenus } from "./bar-menus.ts";
import { openEditor } from "./testing.ts";

type Row = Extract<MenuItem, { id: string }>;
const rowsOf = (items: MenuItem[]): Row[] => items.filter((item): item is Row => item.kind === undefined || item.kind === "item");

async function setup() {
  const editor = await openEditor();
  const ctx = { session: editor.session, ui: editor.ui };
  const format = () => rowsOf(barMenus(ctx).find((menu) => menu.id === "format")!.items());
  return { ...editor, ctx, format };
}

describe("the Format menu", () => {
  it("has the highlight, the paint format and the Table menu", async () => {
    const { format } = await setup();
    const labels = format().map((row) => row.label);
    expect(labels).toEqual(expect.arrayContaining(["Highlight", "Remove highlight", "Paint format", "Copy format", "Paste format", "Table"]));
  });

  it("shows the keys of Copy format and Paste format", async () => {
    const { format } = await setup();
    const rows = format();
    expect(rows.find((row) => row.label === "Copy format")?.keys).toMatch(/Alt\+C|Alt\+Ctrl\+C|⌥/);
    expect(rows.find((row) => row.label === "Paste format")?.keys).toMatch(/Alt\+V|Alt\+Ctrl\+V|⌥/);
  });

  it("offers the highlight only where there are words to highlight", async () => {
    const { session, format } = await setup();
    act(() => session.select([]));
    expect(format().find((row) => row.label === "Highlight")?.disabled).toBe(true);
    act(() => {
      const [id] = session.elements.insert([textBox({ x: 10, y: 10, w: 200, h: 50 }, "words")]) as [string];
      session.select([id]);
    });
    expect(format().find((row) => row.label === "Highlight")?.disabled).toBe(false);
  });

  it("opens the Table menu only for cells that are picked, with the table's actions in it", async () => {
    const { session, format } = await setup();
    const [id] = session.elements.insert([table(3, 3, { x: 100, y: 100, w: 300, h: 150 })]) as [string];
    act(() => session.select([id]));
    expect(format().find((row) => row.label === "Table")?.disabled).toBe(true);
    act(() => session.selectCells(selectionAt(id, { row: 0, col: 0 })));
    const menu = format().find((row) => row.label === "Table");
    expect(menu?.disabled).toBe(false);
    const inner = rowsOf(menu?.items ?? []).map((row) => row.label);
    expect(inner).toEqual(["Insert row above", "Insert row below", "Insert column left", "Insert column right", "Delete rows", "Delete columns", "Merge cells", "Unmerge cells", "Clear cells", "Select all cells", "Select table", "Delete table"]);
    // One cell cannot be merged, nor split.
    expect(rowsOf(menu?.items ?? []).filter((row) => /merge/i.test(row.label)).map((row) => row.disabled)).toEqual([true, true]);
  });
});
