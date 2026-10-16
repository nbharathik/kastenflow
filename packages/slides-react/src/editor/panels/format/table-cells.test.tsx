// The Table and Fill sections with cells picked: the steppers and the buttons work at the cells, and the fill is the cells'.

import type { Element } from "@kasten-slides/wasm";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { table } from "../../factory.ts";
import { selectionAt } from "../../table/cells.ts";
import { edit, held, mount, pickColor, section, slide } from "./test-kit.tsx";

afterEach(cleanup);

type Table = Extract<Element, { type: "table" }>;
const tableOf = (kit: Awaited<ReturnType<typeof mount>>, id: string) => held(kit, id) as Table;
const at = (row: number, col: number) => ({ row, col });
const grid = (rows = 4, columns = 4): Element => table(rows, columns, { x: 100, y: 100, w: columns * 100, h: rows * 40 });
const fills = (kit: Awaited<ReturnType<typeof mount>>, id: string) => tableOf(kit, id).rows.map((row) => row.cells.map((cell) => cell.fill?.color ?? null));

describe("the Table section with cells picked", () => {
  it("adds a row after the rows picked, with the steppers", async () => {
    const kit = await mount({ elements: [grid()] });
    const [id] = kit.ids as [string];
    edit(() => kit.session.selectCells({ table: id, anchor: at(1, 0), focus: at(1, 3) }));
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(tableOf(kit, id).rows).toHaveLength(5);
    expect(kit.session.state.cells).toEqual({ table: id, anchor: at(1, 0), focus: at(1, 3) });
    // The new row is after the picked one: rows 0 and 1 are the same cells, the empty row is row 2.
    expect(tableOf(kit, id).rows[2]?.cells.every((cell) => cell.text.paragraphs.every((p) => p.runs.every((r) => r.t === "")))).toBe(true);
  });

  it("takes away the rows picked, and not the last row, with the other stepper", async () => {
    const kit = await mount({ elements: [grid()] });
    const [id] = kit.ids as [string];
    edit(() => kit.session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 0) }));
    fireEvent.click(screen.getByRole("button", { name: "Remove row" }));
    expect(tableOf(kit, id).rows).toHaveLength(2);
  });

  it("will not take away every row or every column", async () => {
    const kit = await mount({ elements: [grid(2, 2)] });
    const [id] = kit.ids as [string];
    edit(() => kit.session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) }));
    expect(screen.getByRole("button", { name: "Remove row" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Remove column" }).hasAttribute("disabled")).toBe(true);
  });

  it("offers the rows and columns above, below, left and right, and merging", async () => {
    const kit = await mount({ elements: [grid()] });
    const [id] = kit.ids as [string];
    expect(within(section("table")).queryByRole("group", { name: "Cells picked" })).toBeNull();
    edit(() => kit.session.selectCells(selectionAt(id, at(1, 1))));
    const bar = within(section("table")).getByRole("group", { name: "Cells picked" });
    fireEvent.click(within(bar).getByRole("button", { name: "Insert column left" }));
    expect(tableOf(kit, id).columns).toHaveLength(5);
    expect(kit.session.state.cells).toEqual(selectionAt(id, at(1, 2)));
    fireEvent.click(within(bar).getByRole("button", { name: "Insert row above" }));
    expect(tableOf(kit, id).rows).toHaveLength(5);
  });

  it("merges the cells picked and splits them again, enabled only when it can", async () => {
    const kit = await mount({ elements: [grid()] });
    const [id] = kit.ids as [string];
    edit(() => kit.session.selectCells(selectionAt(id, at(0, 0))));
    const merge = () => screen.getByRole("button", { name: "Merge cells" });
    const split = () => screen.getByRole("button", { name: "Unmerge cells" });
    expect([merge().hasAttribute("disabled"), split().hasAttribute("disabled")]).toEqual([true, true]);
    edit(() => kit.session.selectCells({ table: id, anchor: at(0, 0), focus: at(1, 1) }));
    fireEvent.click(merge());
    expect(tableOf(kit, id).rows[0]?.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(split().hasAttribute("disabled")).toBe(false);
    fireEvent.click(split());
    expect(tableOf(kit, id).rows[0]?.cells[0]?.colSpan ?? 1).toBe(1);
  });

  it("has only the steppers when no cells are picked, or in a selection of several tables", async () => {
    const kit = await mount({ elements: [grid(), { ...grid(), y: 300 } as Element] });
    edit(() => kit.session.selectCells(selectionAt(kit.ids[0] as string, at(0, 0))));
    edit(() => kit.session.select(kit.ids));
    expect(within(section("table")).queryByRole("group", { name: "Cells picked" })).toBeNull();
  });
});

describe("the Fill section on a table", () => {
  it("fills the whole table when no cells are picked", async () => {
    const kit = await mount({ elements: [grid(2, 2)] });
    const [id] = kit.ids as [string];
    pickColor("Fill colour", "accent2", section("fill"));
    expect(fills(kit, id)).toEqual([["accent2", "accent2"], ["accent2", "accent2"]]);
    expect(kit.errors).toEqual([]);
  });

  it("fills only the cells picked, in a step of undo of its own", async () => {
    const kit = await mount({ elements: [grid(2, 3)] });
    const [id] = kit.ids as [string];
    edit(() => kit.session.selectCells({ table: id, anchor: at(0, 1), focus: at(1, 2) }));
    expect(within(section("fill")).getByRole("button", { name: "Fill colour" })).toBeTruthy();
    pickColor("Fill colour", "accent2", section("fill"));
    expect(fills(kit, id)).toEqual([[null, "accent2", "accent2"], [null, "accent2", "accent2"]]);
    edit(() => kit.session.undo());
    expect(fills(kit, id)).toEqual([[null, null, null], [null, null, null]]);
  });

  it("takes the fill away from the cells picked with None", async () => {
    const kit = await mount({ elements: [grid(2, 2)] });
    const [id] = kit.ids as [string];
    pickColor("Fill colour", "accent2", section("fill"));
    edit(() => kit.session.selectCells(selectionAt(id, at(1, 1))));
    fireEvent.click(within(section("fill")).getByRole("button", { name: "None" }));
    expect(fills(kit, id)).toEqual([["accent2", "accent2"], ["accent2", null]]);
  });

  it("changes the opacity of cells that have different colours without making them one colour", async () => {
    const kit = await mount({ elements: [grid(1, 2)] });
    const [id] = kit.ids as [string];
    edit(() => kit.session.selectCells(selectionAt(id, at(0, 0))));
    pickColor("Fill colour", "accent2", section("fill"));
    edit(() => kit.session.selectCells(selectionAt(id, at(0, 1))));
    pickColor("Fill colour", "accent3", section("fill"));
    edit(() => kit.session.selectCells({ table: id, anchor: at(0, 0), focus: at(0, 1) }));
    slide(within(section("fill")).getByLabelText("Fill opacity"), 50);
    expect(tableOf(kit, id).rows[0]?.cells.map((cell) => [cell.fill?.color, cell.fill?.alpha])).toEqual([["accent2", 0.5], ["accent3", 0.5]]);
  });

  it("names the section for the cells when cells are picked", async () => {
    const kit = await mount({ elements: [grid(2, 2)] });
    const [id] = kit.ids as [string];
    expect(screen.getByRole("button", { name: "Fill" })).toBeTruthy();
    edit(() => kit.session.selectCells(selectionAt(id, at(0, 0))));
    expect(screen.getByRole("button", { name: "Fill of the cells" })).toBeTruthy();
  });
});
