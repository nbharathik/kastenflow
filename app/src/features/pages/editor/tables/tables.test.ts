// Tables in the page editor: the commands change the table and the saved
// Markdown changes only what they touched; Tab moves between cells; the block
// menu copies CSV and turns a table into a database in one step.

import { editorViewCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { markdownFixtures } from "../../../../test/fixtures";
import { splitFrontmatter } from "../../markdown/frontmatter";
import { createKastenCrepe } from "../crepe";
import { caretAt, crlf, findText } from "../columns/harness";
import type { LinkProvider } from "../links";
import { blockMenuSections } from "../menus/block-menu";
import { openNote } from "../session";
import type { DatabasePlan, TableSpot } from "./database";
import { alignColumn, columnAlignment, insertColumn, insertRow, tableAround } from "./ops";
import { spotOf, turnIntoDatabase } from "./turn";
import type { Crepe } from "@milkdown/crepe";

const PAGE = ["Intro paragraph.", "", "| Name  | Qty | Note |", "|:------|-----|------|", "| apple |   3 | red  |", "| pear  |  12 | green |", "", "After.", ""].join("\n");

const copied: string[] = [];
const calls: DatabasePlan[] = [];
const spots: TableSpot[] = [];
let outcome: { path: string; view: string } | { error: string } = { path: "tags/inventory.yaml", view: "Table" };
let seenDuringCall: string[] = [];

let crepe: Crepe;
let root: HTMLElement;
const view = (): EditorView => crepe.editor.ctx.get(editorViewCtx);

const links: LinkProvider = {
  pages: () => [],
  open: () => {},
  copyText: (text) => void copied.push(text),
  turnTableIntoDatabase: async (plan, spot) => {
    calls.push(plan);
    spots.push(spot);
    seenDuringCall = typesOf(view().state.doc);
    return outcome;
  },
};

beforeAll(async () => {
  root = document.createElement("div");
  document.body.append(root);
  crepe = await createKastenCrepe(root, { links });
});
afterAll(async () => {
  await crepe.destroy();
  root.remove();
});

const typesOf = (doc: Node) => {
  const names: string[] = [];
  doc.forEach((n) => void names.push(n.type.name));
  return names;
};

function press(key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent("keydown", { key, shiftKey, cancelable: true });
  return view().someProp("handleKeyDown", (f) => f(view(), event)) === true;
}

const tablePos = () => {
  let at = -1;
  view().state.doc.forEach((n, offset) => {
    if (n.type.name === "table") at = offset;
  });
  return at;
};

/** The text of the cell the selection is in. */
const cellNow = () => view().state.selection.$from.parent.textContent;

describe("alignment", () => {
  it("writes the delimiter cell and no other byte", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "3");
    alignColumn("center")(view().state, view().dispatch);
    expect(note.save()).toBe(PAGE.replace("|:------|-----|------|", "|:------|:---:|------|"));
  });

  it("aligns every cell of the column, so the table shows it", () => {
    openNote(crepe, PAGE);
    caretAt(view(), "red");
    alignColumn("right")(view().state, view().dispatch);
    const table = view().state.doc.nodeAt(tablePos())!;
    const alignments: unknown[] = [];
    table.forEach((row) => alignments.push(row.child(2).attrs.alignment));
    expect(alignments).toEqual(["right", "right", "right"]);
    expect(columnAlignment(view().state)).toBe("right");
  });

  it("changes `left` to `right` and clears an alignment", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "apple");
    alignColumn("right")(view().state, view().dispatch);
    expect(note.save()).toBe(PAGE.replace("|:------|", "|------:|"));
    alignColumn(null)(view().state, view().dispatch);
    expect(note.save()).toBe(PAGE.replace("|:------|", "|-------|"));
  });

  it("keeps CRLF line ends and touches only the delimiter row", () => {
    const text = crlf(PAGE);
    const note = openNote(crepe, text);
    caretAt(view(), "3");
    alignColumn("center")(view().state, view().dispatch);
    expect(note.save()).toBe(text.replace("|:------|-----|------|", "|:------|:---:|------|"));
  });

  it("changes one delimiter cell of the golden tables page and not a byte more", () => {
    const text = markdownFixtures().find((f) => f.name.endsWith("07-tables.md"))!.text;
    const { prefix, body } = splitFrontmatter(text);
    const note = openNote(crepe, body);
    caretAt(view(), "Left");
    alignColumn("right")(view().state, view().dispatch);
    expect(prefix + note.save()).toBe(text.replace("|:-----|:------:|------:|", "|-----:|:------:|------:|"));
    // And a column added to the table with uneven rows leaves the other tables alone.
    caretAt(view(), "Single column");
    insertColumn("right")(view().state, view().dispatch);
    const saved = prefix + note.save();
    expect(saved).toContain("Name | Value\n--- | ---\nno outer pipes | 42\n");
    expect(saved).toContain("| Uneven | table |\n|---|---|\n| only one cell |\n| three | cells | here |\n");
  });

  it("leaves a text edit in the table to the one row it is in", () => {
    const note = openNote(crepe, PAGE);
    const pos = findText(view().state.doc, "red");
    view().dispatch(view().state.tr.insertText("dark ", pos));
    expect(note.save()).toBe(PAGE.replace("|   3 | red  |", "|   3 | dark red  |"));
  });
});

describe("rows and columns", () => {
  it("adds a row below as one new line", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "pear");
    insertRow("below")(view().state, view().dispatch);
    expect(note.save()).toBe(PAGE.replace("| pear  |  12 | green |", "| pear  |  12 | green |\n|  |  |  |"));
    expect(tableAround(view().state)).toMatchObject({ row: 3, col: 0 });
  });

  it("adds a row in the middle and puts the caret in it", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "apple");
    insertRow("below")(view().state, view().dispatch);
    expect(note.save()).toBe(PAGE.replace("| apple |   3 | red  |", "| apple |   3 | red  |\n|  |  |  |"));
    expect(cellNow()).toBe("");
  });

  it("never adds a row above the header", () => {
    openNote(crepe, PAGE);
    caretAt(view(), "Name");
    insertRow("above")(view().state, view().dispatch);
    expect(view().state.doc.nodeAt(tablePos())!.child(0).child(0).textContent).toBe("Name");
    expect(view().state.doc.nodeAt(tablePos())!.childCount).toBe(4);
  });

  it("adds a column at the end of each line", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "red");
    insertColumn("right")(view().state, view().dispatch);
    expect(note.save()).toBe(
      ["Intro paragraph.", "", "| Name  | Qty | Note |  |", "|:------|-----|------| --- |", "| apple |   3 | red  |  |", "| pear  |  12 | green |  |", "", "After.", ""].join("\n"),
    );
    expect(tableAround(view().state)).toMatchObject({ row: 0, col: 3 });
  });

  it("gives a new column its neighbour's alignment", () => {
    openNote(crepe, PAGE);
    caretAt(view(), "3");
    alignColumn("center")(view().state, view().dispatch);
    insertColumn("right")(view().state, view().dispatch);
    expect(columnAlignment(view().state)).toBe("center");
  });

  it("keeps every byte outside the table", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "pear");
    insertRow("below")(view().state, view().dispatch);
    const saved = note.save();
    expect(saved.startsWith("Intro paragraph.\n\n| Name")).toBe(true);
    expect(saved.endsWith("\n\nAfter.\n")).toBe(true);
  });

  it("does nothing outside a table", () => {
    openNote(crepe, PAGE);
    caretAt(view(), "After");
    expect(insertRow("below")(view().state)).toBe(false);
    expect(insertColumn("right")(view().state)).toBe(false);
    expect(alignColumn("left")(view().state)).toBe(false);
  });
});

describe("Tab", () => {
  it("moves to the next cell and Shift+Tab back", () => {
    openNote(crepe, PAGE);
    caretAt(view(), "apple");
    expect(press("Tab")).toBe(true);
    expect(cellNow()).toBe("3");
    expect(press("Tab")).toBe(true);
    expect(cellNow()).toBe("red");
    expect(press("Tab")).toBe(true);
    expect(cellNow()).toBe("pear");
    expect(press("Tab", true)).toBe(true);
    expect(cellNow()).toBe("red");
  });

  it("adds a row in the last cell and goes into it", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "green");
    expect(press("Tab")).toBe(true);
    expect(tableAround(view().state)).toMatchObject({ row: 3, col: 0 });
    expect(note.save()).toContain("| pear  |  12 | green |\n|  |  |  |\n");
  });

  it("adds no row outside a table", () => {
    openNote(crepe, PAGE);
    caretAt(view(), "After");
    press("Tab");
    expect(view().state.doc.nodeAt(tablePos())!.childCount).toBe(3);
  });
});

describe("the table menu", () => {
  const items = () => blockMenuSections(view(), tablePos()).flatMap((s) => s.items);

  it("offers rows, columns, alignment and CSV, and the database when the page can make one", () => {
    openNote(crepe, PAGE);
    caretAt(view(), "apple");
    expect(items().map((i) => i.key)).toEqual(expect.arrayContaining(["table-row", "table-column", "table-align", "table-csv", "table-database"]));
  });

  it("aligns from the submenu and shows the current choice", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "apple");
    const align = items().find((i) => i.key === "table-align")!;
    const choices = align.submenu!()[0]!.items;
    expect(choices.map((c) => c.label)).toEqual(["Left", "Centre", "Right", "Default"]);
    expect(choices.find((c) => c.active)?.label).toBe("Left");
    choices.find((c) => c.label === "Right")!.onPick!();
    expect(note.save()).toBe(PAGE.replace("|:------|", "|------:|"));
  });

  it("works from the block handle too, with the caret elsewhere", () => {
    const note = openNote(crepe, PAGE);
    caretAt(view(), "After");
    items().find((i) => i.key === "table-column")!.onPick!();
    expect(note.save()).toContain("| Name  | Qty | Note |  |");
  });

  it("copies the table as CSV", () => {
    openNote(crepe, PAGE);
    caretAt(view(), "apple");
    copied.length = 0;
    items().find((i) => i.key === "table-csv")!.onPick!();
    expect(copied).toEqual(["Name,Qty,Note\r\napple,3,red\r\npear,12,green"]);
  });
});

describe("Turn into database", () => {
  it("asks the host for everything, saying which table it is, and writes nothing itself", async () => {
    const note = openNote(crepe, PAGE);
    calls.length = 0;
    spots.length = 0;
    outcome = { path: "tags/inventory.yaml", view: "Table" };
    expect(await turnIntoDatabase(view(), links, tablePos(), "Inventory")).toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tag: "inventory",
      properties: [
        { key: "Qty", type: "number" },
        { key: "Note", type: "text" },
      ],
      notes: [
        { title: "apple", props: { Qty: 3, Note: "red" } },
        { title: "pear", props: { Qty: 12, Note: "green" } },
      ],
    });
    // The first and only table of the page, 3 rows (the header counts) of 3 cells.
    expect(spots).toEqual([{ index: 0, count: 1, rows: 3, columns: 3 }]);
    // The page file has one writer: the host's batch. The editor left the table as it was.
    expect(seenDuringCall).toContain("table");
    expect(typesOf(view().state.doc)).toContain("table");
    expect(note.save()).toBe(PAGE);
    // Nothing in the editor to undo: the host's one commit is what Undo takes back.
    undo(view().state, view().dispatch);
    expect(note.save()).toBe(PAGE);
  });

  it("tells the host which of several tables it is", () => {
    const two = `${PAGE}\n| A | B |\n|---|---|\n| 1 | 2 |\n`;
    openNote(crepe, two);
    const found: { pos: number; node: Node }[] = [];
    view().state.doc.descendants((node, pos) => {
      if (node.type.name === "table") found.push({ pos, node });
      return node.type.name !== "table";
    });
    expect(found).toHaveLength(2);
    expect(found.map((t) => spotOf(view().state.doc, t.node, t.pos))).toEqual([
      { index: 0, count: 2, rows: 3, columns: 3 },
      { index: 1, count: 2, rows: 2, columns: 2 },
    ]);
  });

  it("changes nothing when the host refuses", async () => {
    const note = openNote(crepe, PAGE);
    calls.length = 0;
    outcome = { error: "A note called apple already exists." };
    expect(await turnIntoDatabase(view(), links, tablePos(), "Inventory")).toBe("A note called apple already exists.");
    expect(note.save()).toBe(PAGE);
  });

  it("asks the host nothing when the name or the table cannot work", async () => {
    openNote(crepe, PAGE);
    calls.length = 0;
    expect(await turnIntoDatabase(view(), links, tablePos(), "***")).toMatch(/name/);
    expect(await turnIntoDatabase(view(), links, 0, "Inventory")).toBe("That table is not there any more.");
    expect(calls).toHaveLength(0);
  });

  it("says so when the page cannot make databases", async () => {
    openNote(crepe, PAGE);
    const plain = { pages: () => [], open: vi.fn() } satisfies LinkProvider;
    expect(await turnIntoDatabase(view(), plain, tablePos(), "Inventory")).toMatch(/vault/);
  });

});
